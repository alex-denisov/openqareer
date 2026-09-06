import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getCompanyRegistry, type CompanyRegistry } from '../domain/companyRegistry';

const companyQuerySchema = z.object({
  search: z.string().optional(),
  relocation: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  currency_remote: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ru_abroad: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  full_remote: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  has_ats: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  has_vacancies: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

type CompanyQueryParams = z.infer<typeof companyQuerySchema>;

async function handleListCompanies(
  registry: CompanyRegistry,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const parsed = companyQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'invalid_query_parameters',
      details: parsed.error.issues,
    });
  }

  const query: CompanyQueryParams = parsed.data;
  const allMatching = registry.filter({
    search: query.search,
    relocation: query.relocation,
    currencyRemote: query.currency_remote,
    russianAbroad: query.ru_abroad,
    fullRemote: query.full_remote,
    country: query.country,
    city: query.city,
    hasAtsBoard: query.has_ats,
    hasLiveVacancies: query.has_vacancies,
  });

  const paginated = allMatching.slice(query.offset, query.offset + query.limit);
  return {
    total: allMatching.length,
    count: paginated.length,
    offset: query.offset,
    limit: query.limit,
    items: paginated,
    stats: registry.getStats(),
  };
}

async function handleGetCompany(
  registry: CompanyRegistry,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<unknown> {
  const { id } = request.params;
  const company = registry.getById(id);
  if (!company) {
    return reply.status(404).send({
      error: 'company_not_found',
      message: 'Компания не найдена в реестре',
    });
  }
  return { company };
}

export async function registerCompanyRoutes(app: FastifyInstance): Promise<void> {
  const registry = getCompanyRegistry();

  app.get('/api/v1/companies', async (req, res) => handleListCompanies(registry, req, res));
  app.get('/api/v1/companies/stats', async () => ({ stats: registry.getStats() }));
  app.get<{ Params: { id: string } }>('/api/v1/companies/:id', async (req, res) =>
    handleGetCompany(registry, req, res),
  );
}
