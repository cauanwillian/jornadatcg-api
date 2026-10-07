import { ShippingProvidersService } from './shipping-providers.service.js';
import type { ShippingProvider } from './shipping-providers.service.js';
import { shippingPackage } from '../shipping-package.js';

const input = {
  from: '78556858',
  to: '78000000',
  declaredValue: '100.00',
  package: shippingPackage(30),
};
const response = {
  id: 1,
  name: 'PAC',
  price: '20.50',
  delivery_time: 5,
  company: { name: 'Correios' },
};
describe('Shipping providers', () => {
  const service = new ShippingProvidersService();
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    for (const key of [
      'MELHOR_ENVIO_TOKEN',
      'SUPERFRETE_TOKEN',
      'FRENET_TOKEN',
    ])
      vi.stubEnv(key, 'test-only-token');
    vi.stubEnv('MELHOR_ENVIO_ENVIRONMENT', 'sandbox');
    vi.stubEnv('SUPERFRETE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('SHIPPING_CONTACT_EMAIL', 'fixture@example.invalid');
    fetchMock.mockResolvedValue({ ok: true, json: async () => [response] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it.each([1, 30])('uses the small box for %i cards', (n) =>
    expect(shippingPackage(n)).toEqual({
      name: 'Pequena',
      height: 3,
      width: 12,
      length: 17,
      weight: 0.15,
    }),
  );
  it.each([31, 70])('uses the medium box for %i cards', (n) =>
    expect(shippingPackage(n)).toEqual({
      name: 'Média',
      height: 5,
      width: 10,
      length: 15,
      weight: 0.15,
    }),
  );
  it.each([0, -1, 71, Infinity, 1.5])('rejects unsupported quantity %s', (n) =>
    expect(() => shippingPackage(n)).toThrow(),
  );
  it('sends Melhor Envio volumes and prefers custom price/days', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { ...response, custom_price: '23.45', custom_delivery_time: 7 },
      ],
    });
    expect(await service.quote('melhorenvio', input)).toEqual([
      {
        provider: 'melhorenvio:sandbox',
        serviceCode: '1',
        serviceName: 'PAC',
        carrier: 'Correios',
        amount: '23.45',
        deliveryDays: 7,
      },
    ]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate',
    );
    expect(JSON.parse(request.body)).toMatchObject({
      volumes: [
        { height: 3, width: 12, length: 17, weight: 0.15, insurance: 100 },
      ],
    });
    expect(request.redirect).toBe('error');
  });
  it('sends SuperFrete one package, declared value and Bearer token', async () => {
    await service.quote('superfrete', input);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sandbox.superfrete.com/api/v0/calculator');
    expect(request.headers.Authorization).toBe('Bearer test-only-token');
    expect(JSON.parse(request.body)).toMatchObject({
      from: { postal_code: '78556858' },
      package: { weight: 0.15 },
      options: { use_insurance_value: true, insurance_value: 100 },
    });
  });
  it('uses HTTPS for Frenet and one complete package, not weight times card count', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ShippingSevicesArray: [
          {
            ServiceCode: '03298',
            ServiceDescription: 'PAC',
            Carrier: 'Correios',
            ShippingPrice: '19.10',
            DeliveryTime: '6',
            Error: false,
          },
        ],
      }),
    });
    expect((await service.quote('frenet', input))[0].amount).toBe('19.10');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.frenet.com.br/shipping/quote');
    expect(request.headers.token).toBe('test-only-token');
    expect(JSON.parse(request.body).ShippingItemArray).toEqual([
      {
        Height: 3,
        Width: 12,
        Length: 17,
        Weight: 0.15,
        Quantity: 1,
        SKU: 'JORNADATCG-PACKAGE',
      },
    ]);
  });
  it.each(['melhorenvio', 'superfrete'] as ShippingProvider[])(
    'switches %s to a fixed production host',
    async (provider) => {
      vi.stubEnv(
        provider === 'melhorenvio'
          ? 'MELHOR_ENVIO_ENVIRONMENT'
          : 'SUPERFRETE_ENVIRONMENT',
        'production',
      );
      await service.quote(provider, input);
      expect(fetchMock.mock.calls[0][0]).not.toContain('sandbox');
    },
  );
  it('rejects invalid environment without network calls', async () => {
    vi.stubEnv('SUPERFRETE_ENVIRONMENT', 'evil');
    await expect(service.quote('superfrete', input)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects absent credentials without network calls', async () => {
    vi.stubEnv('FRENET_TOKEN', '');
    await expect(service.quote('frenet', input)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects absent technical contact', async () => {
    vi.stubEnv('SHIPPING_CONTACT_EMAIL', '');
    await expect(service.quote('superfrete', input)).rejects.toMatchObject({
      status: 503,
    });
  });
  it('excludes individual services with errors', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, error: 'No coverage' },
        { ...response, id: 2 },
        { has_error: true },
      ],
    });
    expect(await service.quote('superfrete', input)).toHaveLength(1);
  });
  it('returns an empty list when no service serves the route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    expect(await service.quote('melhorenvio', input)).toEqual([]);
  });
  it.each([
    {},
    null,
    [{ ...response, price: '-1' }],
    [{ ...response, price: '1.234' }],
    [{ ...response, delivery_time: -1 }],
    [{ ...response, company: null }],
  ])('rejects malformed response %#', async (data) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    await expect(service.quote('superfrete', input)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('sanitizes errors and never includes token or provider payload', async () => {
    fetchMock.mockRejectedValue(new Error('test-only-token'));
    await expect(service.quote('superfrete', input)).rejects.toMatchObject({
      status: 503,
      message: 'Falha de comunicação com o provedor de frete.',
    });
  });
  it('distinguishes timeouts', async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    fetchMock.mockRejectedValue(new Error('abort'));
    await expect(service.quote('superfrete', input)).rejects.toMatchObject({
      status: 504,
    });
    spy.mockRestore();
  });
  it('rejects invalid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad');
      },
    });
    await expect(service.quote('frenet', input)).rejects.toMatchObject({
      status: 502,
    });
  });
});
