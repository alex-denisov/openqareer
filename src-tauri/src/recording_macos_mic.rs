//! B758: запись только микрофона для диктовки — AVCaptureSession с устройством ввода звука.
//!
//! Нужно одно разрешение на микрофон: ScreenCaptureKit и запись экрана не участвуют,
//! системной дорожки нет. Сэмплы идут тем же писателям, что и у записи интервью:
//! куски m4a по 10 минут, дорожка `mic`.

use std::path::PathBuf;

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_av_foundation::{
    AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureConnection,
    AVCaptureDevice, AVCaptureDeviceInput, AVCaptureOutput, AVCaptureSession,
};
use objc2_core_media::CMSampleBuffer;
use objc2_foundation::{NSObject, NSObjectProtocol};

use crate::recording::SegmentSink;
use crate::recording_macos::{audio_media_type, OutputIvars};
use crate::recording_upload::Track;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = AnyThread]
    #[name = "OpenQareerMicOutput"]
    #[ivars = OutputIvars]
    pub struct MicOutput;

    unsafe impl NSObjectProtocol for MicOutput {}

    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for MicOutput {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output(
            &self,
            _output: &AVCaptureOutput,
            sample: &CMSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            self.ivars().on_sample(Track::Mic, sample);
        }
    }
);

impl MicOutput {
    fn create(dir: PathBuf, sink: SegmentSink) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars::new(dir, sink));
        // SAFETY: NSObject's init on a freshly allocated instance with ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

/// Идущая запись микрофона. Сессия захвата и писатели дорожки потокобезопасны для этих вызовов.
pub struct MicCapture {
    session: Retained<AVCaptureSession>,
    output: Retained<MicOutput>,
    _queue: dispatch2::DispatchRetained<DispatchQueue>,
}

// SAFETY: AVCaptureSession start/stop may be called from any thread; the output's writers are
// mutex-guarded; MicCapture is only moved between command threads, never shared without a lock.
unsafe impl Send for MicCapture {}

/// Запускает запись микрофона по умолчанию в `dir`. Блокирует поток до старта сессии.
pub fn start(dir: PathBuf, sink: SegmentSink) -> Result<MicCapture, String> {
    // SAFETY: class method with the AVFoundation audio media type constant.
    let device = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(audio_media_type()) }
        .ok_or("no_microphone")?;
    // SAFETY: device from AVFoundation; errors are returned, not thrown.
    let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }
        .map_err(|error| format!("mic_input: {}", error.localizedDescription()))?;
    // SAFETY: plain constructors.
    let (session, data_output) =
        unsafe { (AVCaptureSession::new(), AVCaptureAudioDataOutput::new()) };
    let output = MicOutput::create(dir, sink);
    let queue = DispatchQueue::new("com.openqareer.recording.mic", None);
    // SAFETY: session not running yet; input and output are fresh; the delegate and the queue
    // outlive the session (both held in MicCapture).
    unsafe {
        if !session.canAddInput(&input) {
            return Err("mic_input: rejected".to_string());
        }
        session.addInput(&input);
        if !session.canAddOutput(&data_output) {
            return Err("mic_output: rejected".to_string());
        }
        session.addOutput(&data_output);
        data_output
            .setSampleBufferDelegate_queue(Some(ProtocolObject::from_ref(&*output)), Some(&queue));
        session.startRunning();
        if !session.isRunning() {
            output.ivars().cancel_all();
            return Err("start_capture: not running".to_string());
        }
    }
    Ok(MicCapture {
        session,
        output,
        _queue: queue,
    })
}

/// Останавливает сессию и закрывает открытый кусок; он уходит в `SegmentSink`.
pub fn stop(capture: MicCapture) -> Result<(), String> {
    // SAFETY: stopRunning blocks until the session has stopped delivering samples.
    unsafe { capture.session.stopRunning() };
    capture.output.ivars().finish_all();
    Ok(())
}

/// Выход из приложения посреди записи: остановить сессию, недописанное не отправлять.
pub fn abandon(capture: MicCapture) {
    // SAFETY: as in `stop`.
    unsafe { capture.session.stopRunning() };
    capture.output.ivars().cancel_all();
}
