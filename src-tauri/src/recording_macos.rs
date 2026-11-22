//! B642: запись интервью в .app — микрофон и системный звук двумя дорожками.
//!
//! ScreenCaptureKit отдаёт системный звук (без звука самого приложения) и, с macOS 15,
//! микрофон отдельными потоками сэмплов. Каждая дорожка пишется в AAC m4a кусками
//! по 10 минут; закрытый кусок уходит в `SegmentSink` и дальше на сервер.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVAuthorizationStatus, AVCaptureDevice,
    AVFileTypeAppleM4A, AVMediaTypeAudio,
};
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSOperatingSystemVersion,
    NSProcessInfo, NSString, NSURL,
};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};

use crate::recording_clock::{ClockStep, SegmentClock};
use crate::recording_upload::Track;

const K_AUDIO_FORMAT_MPEG4_AAC: u32 = 0x6161_6320; // 'aac '
const OUTPUT_SAMPLE_RATE: i32 = 16_000;
const OUTPUT_BIT_RATE: i32 = 32_000;
const CAPTURE_SAMPLE_RATE: isize = 48_000;
const SYSTEM_CALL_TIMEOUT: Duration = Duration::from_secs(15);

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub use crate::recording::SegmentSink;
use crate::recording::{SegmentEvent, WrittenSegment};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Granted,
    Denied,
    Undetermined,
}

/// Микрофон в ScreenCaptureKit есть с macOS 15.
pub fn is_supported() -> bool {
    let version = NSOperatingSystemVersion {
        majorVersion: 15,
        minorVersion: 0,
        patchVersion: 0,
    };
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(version)
}

fn audio_media_type() -> &'static NSString {
    // SAFETY: AVMediaTypeAudio is a constant NSString exported by AVFoundation.
    unsafe { AVMediaTypeAudio }.expect("AVFoundation exports AVMediaTypeAudio")
}

pub fn microphone_access() -> Access {
    // SAFETY: plain class method on the AVFoundation constant.
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio_media_type()) };
    match status {
        AVAuthorizationStatus::Authorized => Access::Granted,
        AVAuthorizationStatus::NotDetermined => Access::Undetermined,
        _ => Access::Denied,
    }
}

/// Без запроса macOS не скажет «ещё не спрашивали»: до запроса это `Undetermined`.
pub fn screen_access(asked: bool) -> Access {
    // SAFETY: CoreGraphics function without arguments.
    if unsafe { CGPreflightScreenCaptureAccess() } {
        Access::Granted
    } else if asked {
        Access::Denied
    } else {
        Access::Undetermined
    }
}

/// Блокирует поток до ответа системного окна микрофона; звать вне главного потока.
pub fn request_microphone() -> Access {
    if microphone_access() != Access::Undetermined {
        return microphone_access();
    }
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });
    // SAFETY: the block is 'static and only sends on a channel.
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(audio_media_type(), &block)
    };
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Access::Granted,
        _ => microphone_access(),
    }
}

/// Открывает системное окно «Запись экрана и системного звука», если доступа нет.
pub fn request_screen() -> Access {
    // SAFETY: CoreGraphics function without arguments.
    if unsafe { CGRequestScreenCaptureAccess() } {
        Access::Granted
    } else {
        Access::Denied
    }
}

struct OpenFile {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    path: PathBuf,
    started_at: String,
    index: u32,
}

struct TrackWriter {
    track: Track,
    clock: SegmentClock,
    file: Option<OpenFile>,
}

impl TrackWriter {
    fn new(track: Track) -> Self {
        Self {
            track,
            clock: SegmentClock::default(),
            file: None,
        }
    }
}

pub struct OutputIvars {
    dir: PathBuf,
    sink: SegmentSink,
    tracks: Mutex<[TrackWriter; 2]>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = AnyThread]
    #[name = "OpenQareerRecordingOutput"]
    #[ivars = OutputIvars]
    pub struct RecordingOutput;

    unsafe impl NSObjectProtocol for RecordingOutput {}

    unsafe impl SCStreamOutput for RecordingOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            let track = match kind {
                SCStreamOutputType::Audio => Track::System,
                SCStreamOutputType::Microphone => Track::Mic,
                _ => return,
            };
            self.ivars().on_sample(track, sample);
        }
    }
);

impl RecordingOutput {
    fn create(dir: PathBuf, sink: SegmentSink) -> Retained<Self> {
        let ivars = OutputIvars {
            dir,
            sink,
            tracks: Mutex::new([
                TrackWriter::new(Track::Mic),
                TrackWriter::new(Track::System),
            ]),
        };
        let this = Self::alloc().set_ivars(ivars);
        // SAFETY: NSObject's init on a freshly allocated instance with ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

impl OutputIvars {
    fn on_sample(&self, track: Track, sample: &CMSampleBuffer) {
        // SAFETY: the buffer is valid for the duration of the callback.
        let usable = unsafe { sample.is_valid() && sample.num_samples() > 0 };
        if !usable {
            return;
        }
        // SAFETY: as above.
        let pts = unsafe { sample.presentation_time_stamp() };
        // SAFETY: CMTimeGetSeconds on a value CoreMedia produced.
        let seconds = unsafe { pts.seconds() };
        let Ok(mut tracks) = self.tracks.lock() else {
            return;
        };
        let writer = &mut tracks[usize::from(track == Track::System)];
        let previous = writer.clock.open_segment();
        match writer.clock.on_sample(seconds) {
            ClockStep::Open { index } => writer.file = open_file(&self.dir, track, index, pts),
            ClockStep::Continue => {}
            ClockStep::Rotate { next, .. } => {
                if let (Some(file), Some((_, duration))) = (writer.file.take(), previous) {
                    finish_file(file, writer.track, duration, self.sink.clone());
                }
                writer.file = open_file(&self.dir, track, next, pts);
            }
        }
        if let Some(file) = &writer.file {
            // SAFETY: input belongs to a writer in the Writing state; buffer is valid.
            unsafe {
                if file.input.isReadyForMoreMediaData() {
                    file.input.appendSampleBuffer(sample);
                }
            }
        }
    }

    fn finish_all(&self) {
        let Ok(mut tracks) = self.tracks.lock() else {
            return;
        };
        for writer in tracks.iter_mut() {
            if let (Some(file), Some((_, duration))) =
                (writer.file.take(), writer.clock.open_segment())
            {
                finish_file(file, writer.track, duration, self.sink.clone());
            }
        }
    }

    /// Бросает открытые куски без отправки: AVAssetWriter удаляет недописанный файл сам.
    fn cancel_all(&self) {
        let Ok(mut tracks) = self.tracks.lock() else {
            return;
        };
        for writer in tracks.iter_mut() {
            if let Some(file) = writer.file.take() {
                // SAFETY: cancelling a writer that is in the Writing state.
                unsafe { file.writer.cancelWriting() };
                let _ = std::fs::remove_file(&file.path);
            }
        }
    }
}

fn output_settings() -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys = [
        NSString::from_str("AVFormatIDKey"),
        NSString::from_str("AVSampleRateKey"),
        NSString::from_str("AVNumberOfChannelsKey"),
        NSString::from_str("AVEncoderBitRateKey"),
    ];
    let values = [
        NSNumber::numberWithUnsignedInt(K_AUDIO_FORMAT_MPEG4_AAC),
        NSNumber::numberWithInt(OUTPUT_SAMPLE_RATE),
        NSNumber::numberWithInt(1),
        NSNumber::numberWithInt(OUTPUT_BIT_RATE),
    ];
    let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let value_refs: Vec<&AnyObject> = values.iter().map(|value| value.as_ref()).collect();
    NSDictionary::from_slices(&key_refs, &value_refs)
}

fn open_file(dir: &Path, track: Track, index: u32, start: CMTime) -> Option<OpenFile> {
    let path = dir.join(format!("{}-{index}.m4a", track.as_str()));
    let _ = std::fs::remove_file(&path);
    let url = NSURL::from_file_path(&path)?;
    // SAFETY: constant exported by AVFoundation.
    let file_type = unsafe { AVFileTypeAppleM4A }?;
    // SAFETY: valid file URL and file type; errors are returned, not thrown.
    let writer = match unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, file_type) }
    {
        Ok(writer) => writer,
        Err(error) => {
            eprintln!(
                "recording: {} writer: {}",
                track.as_str(),
                error.localizedDescription()
            );
            return None;
        }
    };
    let settings = output_settings();
    // SAFETY: audio media type with AAC settings AVAssetWriterInput accepts.
    let input = unsafe {
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            audio_media_type(),
            Some(&settings),
        )
    };
    // SAFETY: writer is in the Unknown state; input not yet attached.
    unsafe {
        input.setExpectsMediaDataInRealTime(true);
        if !writer.canAddInput(&input) {
            eprintln!("recording: {} input rejected", track.as_str());
            return None;
        }
        writer.addInput(&input);
        if !writer.startWriting() {
            eprintln!("recording: {} writer did not start", track.as_str());
            return None;
        }
        writer.startSessionAtSourceTime(start);
    }
    Some(OpenFile {
        writer,
        input,
        path,
        started_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        index,
    })
}

fn finish_file(file: OpenFile, track: Track, duration_ms: u64, sink: SegmentSink) {
    let OpenFile {
        writer,
        input,
        path,
        started_at,
        index,
    } = file;
    sink(SegmentEvent::Closing);
    let done_writer = writer.clone();
    let block = RcBlock::new(move || {
        // SAFETY: status read after the writer reported completion.
        let completed = unsafe { done_writer.status() } == AVAssetWriterStatus::Completed;
        if completed {
            sink(SegmentEvent::Written(WrittenSegment {
                track,
                index,
                started_at: started_at.clone(),
                duration_ms,
                path: path.clone(),
            }));
        } else {
            eprintln!("recording: {} segment {index} not written", track.as_str());
            let _ = std::fs::remove_file(&path);
            sink(SegmentEvent::Lost);
        }
    });
    // SAFETY: input belongs to this writer; the block only touches Send data and the writer.
    unsafe {
        input.markAsFinished();
        writer.finishWritingWithCompletionHandler(&block);
    }
}

/// Идущая запись. ScreenCaptureKit и AVAssetWriter потокобезопасны для этих вызовов,
/// а доступ к писателям дорожек идёт под мьютексом.
pub struct Capture {
    stream: Retained<SCStream>,
    output: Retained<RecordingOutput>,
    _queue: dispatch2::DispatchRetained<DispatchQueue>,
}

// SAFETY: SCStream start/stop and the output's mutex-guarded writers may be used from any
// thread; Capture is only moved between the command threads, never shared without a lock.
unsafe impl Send for Capture {}

fn wait_error(rx: &mpsc::Receiver<Option<String>>, what: &str) -> Result<(), String> {
    match rx.recv_timeout(SYSTEM_CALL_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(error)) => Err(format!("{what}: {error}")),
        Err(_) => Err(format!("{what}: timeout")),
    }
}

fn error_text(error: *mut NSError) -> Option<String> {
    // SAFETY: the pointer comes from a completion handler and is either null or a valid NSError.
    unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string())
}

fn first_display() -> Result<Retained<SCContentFilter>, String> {
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            // SAFETY: valid or null pointer handed over by ScreenCaptureKit for this call.
            let content = unsafe { Retained::retain(content) };
            let display = content.and_then(|content| unsafe { content.displays() }.firstObject());
            let _ = tx.send(
                display
                    .map(SendDisplay)
                    .ok_or_else(|| error_text(error).unwrap_or_else(|| "no_display".to_string())),
            );
        },
    );
    // SAFETY: the block is 'static and only sends on a channel.
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    let display = rx
        .recv_timeout(SYSTEM_CALL_TIMEOUT)
        .map_err(|_| "shareable_content: timeout".to_string())??
        .0;
    let excluded = NSArray::new();
    // SAFETY: display from ScreenCaptureKit, empty exclusion list.
    Ok(unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &display,
            &excluded,
        )
    })
}

struct SendDisplay(Retained<objc2_screen_capture_kit::SCDisplay>);
// SAFETY: SCDisplay is an immutable description object; it is only moved to the caller thread.
unsafe impl Send for SendDisplay {}

fn stream_config() -> Retained<SCStreamConfiguration> {
    // SAFETY: setters on a fresh configuration object.
    unsafe {
        let config = SCStreamConfiguration::new();
        config.setCapturesAudio(true);
        config.setExcludesCurrentProcessAudio(true);
        config.setCaptureMicrophone(true);
        config.setSampleRate(CAPTURE_SAMPLE_RATE);
        config.setChannelCount(1);
        // Видео не нужно, но поток без кадров не стартует: самый маленький кадр раз в 10 с.
        config.setWidth(2);
        config.setHeight(2);
        config.setMinimumFrameInterval(CMTime::with_seconds(10.0, 1));
        config
    }
}

/// Запускает запись в `dir`. Блокирует поток до ответа ScreenCaptureKit.
pub fn start(dir: PathBuf, sink: SegmentSink) -> Result<Capture, String> {
    let filter = first_display()?;
    let config = stream_config();
    // SAFETY: filter and config are valid; no delegate.
    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &config, None)
    };
    let output = RecordingOutput::create(dir, sink);
    let queue = DispatchQueue::new("com.openqareer.recording", None);
    let handler = ProtocolObject::from_ref(&*output);
    for kind in [
        SCStreamOutputType::Screen,
        SCStreamOutputType::Audio,
        SCStreamOutputType::Microphone,
    ] {
        // SAFETY: output implements SCStreamOutput; queue outlives the stream (held in Capture).
        unsafe {
            stream.addStreamOutput_type_sampleHandlerQueue_error(handler, kind, Some(&queue))
        }
        .map_err(|error| format!("add_output: {}", error.localizedDescription()))?;
    }
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let _ = tx.send(error_text(error));
    });
    // SAFETY: the block is 'static and only sends on a channel.
    unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
    if let Err(error) = wait_error(&rx, "start_capture") {
        // Поток мог стартовать позже ответа: остановить его, чтобы он не писал втихую.
        let _ = stop_stream(&stream);
        output.ivars().cancel_all();
        return Err(error);
    }
    Ok(Capture {
        stream,
        output,
        _queue: queue,
    })
}

/// Останавливает поток и закрывает открытые куски; они уходят в `SegmentSink`.
fn stop_stream(stream: &SCStream) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let _ = tx.send(error_text(error));
    });
    // SAFETY: the block is 'static and only sends on a channel.
    unsafe { stream.stopCaptureWithCompletionHandler(Some(&block)) };
    wait_error(&rx, "stop_capture")
}

pub fn stop(capture: Capture) -> Result<(), String> {
    let stopped = stop_stream(&capture.stream);
    capture.output.ivars().finish_all();
    stopped
}

/// Выход из приложения посреди записи: остановить поток, недописанное не отправлять.
pub fn abandon(capture: Capture) {
    let _ = stop_stream(&capture.stream);
    capture.output.ivars().cancel_all();
}
