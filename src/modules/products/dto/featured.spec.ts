import { UpdateProductPipe, CreateProductPipe } from './products.dto.js';
describe('Featured product validation', () => {
  const pipe = new UpdateProductPipe();
  it('accepts selection, removal and ordering', () => {
    expect(pipe.transform({ featured: true, featuredOrder: 2 })).toEqual({
      featured: true,
      featuredOrder: 2,
    });
    expect(pipe.transform({ featured: false })).toEqual({ featured: false });
  });
  it.each([
    { featured: 'true' },
    { featured: null },
    { featuredOrder: -1 },
    { featuredOrder: 1.5 },
    { featuredOrder: '1' },
    { featuredOrder: 2147483648 },
  ])('rejects invalid fields %j', (body) => {
    expect(() => pipe.transform(body)).toThrow();
  });
  it('allows featured fields when creating a product', () => {
    const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
    expect(
      new CreateProductPipe().transform({
        cardId: id,
        conditionId: id,
        languageId: id,
        categoryId: id,
        price: '1.00',
        featured: true,
        featuredOrder: 0,
      }),
    ).toMatchObject({ featured: true, featuredOrder: 0 });
  });
});
