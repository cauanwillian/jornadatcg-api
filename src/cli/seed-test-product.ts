import 'dotenv/config';
import { PrismaService } from '../database/prisma.service.js';

// Stable identity makes repeat executions safe, even after purchases consume stock.
const productId = 'c70182cc-f671-480c-87f2-b4914659de22';
const externalId = 'local-test-jornadatcg-pikachu-001';

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.ASAAS_ENVIRONMENT ?? 'sandbox') !== 'sandbox'
  ) {
    console.error(
      'O cadastro de teste exige ambiente de desenvolvimento e ASAAS_ENVIRONMENT=sandbox.',
    );
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaService();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const product = await prisma.$transaction(
          async (tx) => {
            const select = {
              id: true,
              price: true,
              active: true,
              card: { select: { name: true, externalId: true } },
              inventory: {
                select: {
                  availableQuantity: true,
                  reservedQuantity: true,
                  soldQuantity: true,
                },
              },
            } as const;
            const existing = await tx.product.findUnique({
              where: { id: productId },
              select,
            });
            if (existing) {
              if (existing.card.externalId !== externalId)
                throw new Error(
                  'Identificador de teste já utilizado por outro produto.',
                );
              return existing;
            }
            const set = await tx.cardSet.upsert({
              where: { externalId: 'local-test-jornadatcg-set' },
              update: {},
              create: {
                externalId: 'local-test-jornadatcg-set',
                name: '[TESTE] Coleção JornadaTCG',
                printedTotal: 1,
                total: 1,
              },
              select: { id: true },
            });
            const card = await tx.card.upsert({
              where: { externalId },
              update: {},
              create: {
                externalId,
                setId: set.id,
                name: '[TESTE] Pikachu fictício',
                number: '001',
                metadata: { testFixture: true, source: 'local' },
              },
              select: { id: true },
            });
            const category = await tx.category.upsert({
              where: { slug: 'jornadatcg-test-fixtures' },
              update: {},
              create: {
                slug: 'jornadatcg-test-fixtures',
                name: '[TESTE] Cartas avulsas',
              },
              select: { id: true },
            });
            const condition = await tx.condition.upsert({
              where: { code: 'TEST-NM' },
              update: {},
              create: { code: 'TEST-NM', name: '[TESTE] Near Mint' },
              select: { id: true },
            });
            const language = await tx.language.upsert({
              where: { code: 'TEST-PT-BR' },
              update: {},
              create: { code: 'TEST-PT-BR', name: '[TESTE] Português' },
              select: { id: true },
            });
            return tx.product.create({
              data: {
                id: productId,
                cardId: card.id,
                categoryId: category.id,
                conditionId: condition.id,
                languageId: language.id,
                price: '10.00',
                active: true,
                observation:
                  'Produto fictício para testar carrinho, pedidos e Pix sandbox. Não representa uma carta real à venda.',
                inventory: {
                  create: {
                    availableQuantity: 5,
                    reservedQuantity: 0,
                    soldQuantity: 0,
                  },
                },
              },
              select,
            });
          },
          { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
        );
        console.log(
          JSON.stringify(
            {
              productId: product.id,
              name: product.card.name,
              price: product.price.toFixed(2),
              active: product.active,
              inventory: product.inventory,
            },
            null,
            2,
          ),
        );
        break;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
  } catch {
    console.error(
      'Não foi possível preparar o produto de teste. Verifique a conexão, as migrations e eventuais conflitos nos identificadores de teste.',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
