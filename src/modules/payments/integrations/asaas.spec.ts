import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AsaasRejectedRequest, AsaasService } from './asaas.service.js';

const raw = {
  id: 'pay_123',
  customer: 'cus_123',
  externalReference: 'ref-123',
  billingType: 'PIX',
  value: 10.5,
  status: 'PENDING',
  deleted: false,
};
describe('Asaas HTTP adapter', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let service: AsaasService;
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ASAAS_API_KEY', 'test-api-key');
    vi.stubEnv('ASAAS_ENVIRONMENT', 'sandbox');
    service = new AsaasService();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('uses sandbox, authenticates only in headers and normalizes payment amounts', async () => {
    fetchMock.mockResolvedValue(response(raw));
    expect(await service.getPayment('pay_123')).toMatchObject({
      id: 'pay_123',
      amount: '10.50',
      billingType: 'PIX',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-sandbox.asaas.com/v3/payments/pay_123',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          access_token: 'test-api-key',
          'User-Agent': 'JornadaTCG/1.0',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('uses production only when explicitly configured', async () => {
    vi.stubEnv('ASAAS_ENVIRONMENT', 'production');
    fetchMock.mockResolvedValue(response(raw));
    await service.getPayment('pay_123');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.asaas.com/v3/payments/pay_123',
    );
    expect(service.provider).toBe('asaas:production');
  });
  it.each(['', 'wrong'])(
    'rejects invalid environment %s without network requests',
    async (environment) => {
      vi.stubEnv('ASAAS_ENVIRONMENT', environment);
      await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('requires an API key before sending', async () => {
    vi.stubEnv('ASAAS_API_KEY', '');
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('creates a Pix with server amount, external reference and no interest or fine', async () => {
    fetchMock.mockResolvedValue(response(raw));
    await service.createPix({
      customer: 'cus_123',
      amount: '10.50',
      reference: 'ref-123',
      expiresAt: new Date('2026-09-27T01:00:00Z'),
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      customer: 'cus_123',
      billingType: 'PIX',
      value: 10.5,
      dueDate: '2026-09-26',
      externalReference: 'ref-123',
      description: 'Compra JornadaTCG',
      fine: { value: 0 },
      interest: { value: 0 },
    });
  });
  it('recovers by external reference and refuses ambiguous duplicates', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: [raw], hasMore: false }));
    expect((await service.findPayment('ref-123'))?.id).toBe('pay_123');
    fetchMock.mockResolvedValueOnce(
      response({ data: [raw, raw], hasMore: false }),
    );
    await expect(service.findPayment('ref-123')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('returns null when an uncertain creation cannot yet be found', async () => {
    fetchMock.mockResolvedValue(response({ data: [], hasMore: false }));
    expect(await service.findPayment('ref-123')).toBeNull();
  });
  it('reuses the same customer with matching CPF and reference', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            id: 'cus_123',
            cpfCnpj: '52998224725',
            externalReference: 'user-1',
          },
        ],
        hasMore: false,
      }),
    );
    expect(
      await service.customer(
        { id: 'user-1', name: 'Test', email: 'test@example.com' },
        '52998224725',
      ),
    ).toBe('cus_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('creates customers with provider notifications disabled', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: [], hasMore: false }))
      .mockResolvedValueOnce(response({ id: 'cus_123' }));
    await service.customer(
      { id: 'user-1', name: 'Test', email: 'test@example.com' },
      '52998224725',
    );
    expect(
      JSON.parse(fetchMock.mock.calls[1][1]!.body as string),
    ).toMatchObject({
      notificationDisabled: true,
      externalReference: 'user-1',
    });
  });
  it('returns normalized QR data', async () => {
    fetchMock.mockResolvedValue(
      response({
        encodedImage: 'aGVsbG8=',
        payload: '000201',
        expirationDate: '2027-09-26 23:59:59',
        extra: 'secret',
      }),
    );
    expect(await service.qrCode('pay_123')).toEqual({
      encodedImage: 'aGVsbG8=',
      payload: '000201',
      expirationDate: '2027-09-26 23:59:59',
    });
  });
  it('requires affirmative deletion response', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ id: 'pay_123', deleted: false }),
    );
    await expect(service.deletePayment('pay_123')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    fetchMock.mockResolvedValueOnce(response({ id: 'pay_123', deleted: true }));
    await expect(service.deletePayment('pay_123')).resolves.toBeUndefined();
  });
  it.each([
    { ...raw, value: 10.555 },
    { ...raw, value: -1 },
    { ...raw, id: 'pay_other' },
    { ...raw, deleted: 'true' },
    { ...raw, value: '10.50' },
  ])('rejects invalid provider response', async (value) => {
    fetchMock.mockResolvedValue(response(value));
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('allows unrelated account charges to be identified and ignored by reconciliation', async () => {
    fetchMock.mockResolvedValue(
      response({ ...raw, billingType: 'BOLETO', externalReference: null }),
    );
    expect(await service.getPayment('pay_123')).toMatchObject({
      externalReference: '',
      billingType: 'BOLETO',
    });
  });
  it('sanitizes definitive rejections without exposing provider body', async () => {
    fetchMock.mockResolvedValue(
      response({ errors: [{ description: 'secret cpf' }] }, 400),
    );
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      AsaasRejectedRequest,
    );
    await expect(service.getPayment('pay_123')).rejects.not.toThrow(
      'secret cpf',
    );
  });
  it.each([401, 403, 429, 500])('sanitizes HTTP %s', async (status) => {
    fetchMock.mockResolvedValue(response({ secret: 'internal' }, status));
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('distinguishes timeout from malformed JSON and transport failures', async () => {
    const signal = AbortSignal.abort();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    fetchMock.mockRejectedValue(new Error('secret transport'));
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    timeout.mockRestore();
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    fetchMock.mockResolvedValue(new Response('{invalid'));
    await expect(service.getPayment('pay_123')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
