import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MelhorEnvioLabelsService } from './melhor-envio-labels.service.js';
const id = 'c9999999-9999-4999-8999-999999999999';
describe('MelhorEnvioLabelsService HTTP', () => {
  const service = new MelhorEnvioLabelsService();
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('MELHOR_ENVIO_ENVIRONMENT', 'sandbox');
    vi.stubEnv('MELHOR_ENVIO_TOKEN', 'test-token');
    vi.stubEnv('SHIPPING_CONTACT_EMAIL', 'test@example.com');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  it('creates through the sandbox cart and returns only the identifier', async () => {
    reply({ id, secret: 'private' });
    expect(await service.create({ service: 1 })).toBe(id);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.melhorenvio.com.br/api/v2/me/cart',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        body: JSON.stringify({ service: 1 }),
      }),
    );
  });
  it('normalizes details and dates', async () => {
    reply({
      id,
      status: 'released',
      price: '12.68',
      service_id: 2,
      tags: [{ tag: 'shipment' }],
      paid_at: '2026-10-02 10:00:00',
      from: { postal_code: '78556858' },
      to: { postal_code: '78000000', document: '52998224725' },
    });
    expect(await service.get(id)).toMatchObject({
      id,
      cost: '12.68',
      serviceCode: '2',
      paid: true,
      tags: ['shipment'],
      generatedAt: null,
    });
  });
  it('purchases only the requested label', async () => {
    reply({});
    await service.checkout(id);
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ orders: [id] }),
    );
  });
  it('requires confirmation of generation', async () => {
    reply({ [id]: { status: false } });
    await expect(service.generate(id)).rejects.toMatchObject({ status: 502 });
  });
  it('returns a private printing URL', async () => {
    const url = 'https://sandbox.melhorenvio.com.br/imprimir/test';
    reply({ url });
    expect(await service.print(id)).toEqual({ url, mode: 'private' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mode).toBe('private');
  });
  it.each([
    'https://evil.example/label',
    'http://sandbox.melhorenvio.com.br/label',
    'https://user:password@sandbox.melhorenvio.com.br/label',
  ])('rejects unsafe print URL %s', async (url) => {
    reply({ url });
    await expect(service.print(id)).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    [400, 400],
    [422, 400],
    [401, 503],
    [500, 503],
  ])('sanitizes HTTP %s', async (remote, local) => {
    reply({ error: 'secret' }, remote);
    await expect(service.create({})).rejects.toMatchObject({ status: local });
  });
  it('rejects malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('{'));
    await expect(service.create({})).rejects.toMatchObject({ status: 502 });
  });
  it('explains identical sender and recipient CPF without disclosing the value', async () => {
    reply(
      { error: 'O CPF do remetente e do destinatário não podem ser iguais' },
      422,
    );
    await expect(service.create({})).rejects.toMatchObject({
      response: {
        message: 'O CPF do remetente e o do destinatário não podem ser iguais.',
        fields: ['from.document', 'to.document'],
      },
    });
  });
  it('exposes only recognized validation paths, never provider messages or arbitrary keys', async () => {
    reply(
      {
        message: 'private document',
        errors: {
          'from.document': ['private document'],
          'volumes.0.width': ['private value'],
          'secret@example.com': ['secret'],
        },
      },
      422,
    );
    await expect(service.create({})).rejects.toMatchObject({
      response: {
        fields: ['from.document', 'volumes.0.width'],
        message:
          'Melhor Envio recusou campos da etiqueta. Revise os campos indicados.',
      },
    });
  });
  it('handles an expired timeout', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    fetchMock.mockRejectedValue(new Error('secret'));
    await expect(service.create({})).rejects.toMatchObject({ status: 504 });
  });
  it('handles network failures', async () => {
    fetchMock.mockRejectedValue(new Error('secret'));
    await expect(service.create({})).rejects.toMatchObject({ status: 503 });
  });
});
