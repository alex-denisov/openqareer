/** Seed only the disposable native demo through actual candidate HTTP handlers. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { StoredResumeVersion } from '../../server/domain/resumeVersions';

async function createVersion(
  app: FastifyInstance,
  origin: string,
  title: string,
  requirements: readonly string[],
  revision: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/resume/versions',
    headers: { origin, 'idempotency-key': randomUUID() },
    payload: { title, requirements, expectedMasterRevision: revision },
  });
  if (response.statusCode !== 201)
    throw new Error(`Synthetic version creation failed: ${response.statusCode}`);
  return response.json<{ data: { version: StoredResumeVersion } }>().data.version;
}

export async function seedDemoResumeVersions(app: FastifyInstance, origin: string) {
  const listing = await app.inject({ method: 'GET', url: '/api/v1/candidate/resume/versions' });
  if (listing.statusCode !== 200)
    throw new Error(`Synthetic master read failed: ${listing.statusCode}`);
  const revision = listing.json<{ data: { currentMasterRevision: string } }>().data
    .currentMasterRevision;
  const version = await createVersion(
    app,
    origin,
    'Под вакансию «Вектор Банк»',
    ['Kafka', 'Kubernetes', 'руководство инженерной командой'],
    revision,
  );
  await createVersion(
    app,
    origin,
    'Под вакансию «Гринкод»',
    ['сервисная архитектура', 'финтех', 'руководство командой'],
    revision,
  );
  const approved = await app.inject({
    method: 'PUT',
    url: `/api/v1/candidate/resume/versions/${version.id}`,
    headers: { origin },
    payload: {
      title: version.title,
      requirements: version.requirements,
      expectedMasterRevision: revision,
      expectedRevision: version.revision,
      status: 'approved',
    },
  });
  if (
    approved.statusCode !== 200 ||
    approved.json<{ data: { version: StoredResumeVersion } }>().data.version.status !== 'approved'
  ) {
    throw new Error(`Synthetic version approval failed: ${approved.statusCode}`);
  }
  console.log(
    'demo-version-seed: 2 persisted snapshots; one approved through actual CAS HTTP handler.',
  );
}
