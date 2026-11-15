import { db } from './index.ts';
import {
  categories,
  products,
  productVariants,
  productAddons,
  restaurantSettings,
} from './schema.ts';
import { eq, and, notInArray } from 'drizzle-orm';

export async function seedGrineRestaurantMenu() {
  console.log('--- Starting Safe Non-Destructive Grine Restaurant Menu Sync ---');

  const settingsData = [
    { key: 'restaurant_name', value: 'GRINE RESTAURANT' },
    { key: 'restaurant_brand', value: 'Grine Restaurant • مطعم قرين' },
    { key: 'restaurant_address', value: 'الجزائر العاصمة • مطعم قرين للمأكولات الراقية' },
    { key: 'restaurant_phone', value: '0550123456' },
    { key: 'currency', value: 'DZD' },
    { key: 'receipt_size', value: '80mm' },
    { key: 'default_language', value: 'ar' },
  ];

  const grineCategories = [
    {
      nameAr: 'قسم الطاكوس',
      nameFr: 'Tacos',
      nameEn: 'Tacos',
      icon: 'Sandwich',
      color: 'amber',
      sortOrder: 1,
      station: 'MAIN_KITCHEN',
    },
    {
      nameAr: 'قسم المأكولات البحرية',
      nameFr: 'Poissons & Fruits de mer',
      nameEn: 'Seafood',
      icon: 'Fish',
      color: 'blue',
      sortOrder: 2,
      station: 'MAIN_KITCHEN',
    },
    {
      nameAr: 'الأطباق الرئيسية',
      nameFr: 'Plats Principaux',
      nameEn: 'Main Dishes',
      icon: 'UtensilsCrossed',
      color: 'orange',
      sortOrder: 3,
      station: 'MAIN_KITCHEN',
    },
    {
      nameAr: 'المقبلات',
      nameFr: 'Entrées & Soupes',
      nameEn: 'Appetizers',
      icon: 'Soup',
      color: 'red',
      sortOrder: 4,
      station: 'MAIN_KITCHEN',
    },
    {
      nameAr: 'التحلية',
      nameFr: 'Desserts',
      nameEn: 'Desserts',
      icon: 'Cake',
      color: 'pink',
      sortOrder: 5,
      station: 'DESSERT',
    },
    {
      nameAr: 'المشروبات',
      nameFr: 'Boissons & Jus',
      nameEn: 'Drinks',
      icon: 'GlassWater',
      color: 'cyan',
      sortOrder: 6,
      station: 'DRINKS',
    },
    {
      nameAr: 'البيتزا',
      nameFr: 'Pizzas',
      nameEn: 'Pizza',
      icon: 'Pizza',
      color: 'emerald',
      sortOrder: 7,
      station: 'MAIN_KITCHEN',
    },
  ];

  const tacosProducts = [
    { nameAr: 'طاكوس بولي', nameFr: 'Tacos Poulet', price: 400, barcode: 'GR-TAC-01' },
    { nameAr: 'طاكوس لحم', nameFr: 'Tacos Viande', price: 600, barcode: 'GR-TAC-02' },
    { nameAr: 'طاكوس 3 أجبان', nameFr: 'Tacos 3 Fromages', price: 600, barcode: 'GR-TAC-03' },
  ];

  const seafoodProducts = [
    { nameAr: 'بايلا', nameFr: 'Paella Royale', price: 2000, barcode: 'GR-SEA-01' },
    { nameAr: 'سلمون مشوي', nameFr: 'Saumon Grillé', price: 2500, barcode: 'GR-SEA-02' },
    { nameAr: 'سردين مقلي', nameFr: 'Sardines Frites', price: 600, barcode: 'GR-SEA-03' },
    { nameAr: 'روجي', nameFr: 'Rouget Grillé', price: 1000, barcode: 'GR-SEA-04' },
    { nameAr: 'دوراد مشوي', nameFr: 'Daurade Grillée', price: 1000, barcode: 'GR-SEA-05' },
    { nameAr: 'سيادون', nameFr: 'Espadon Grillé', price: 2200, barcode: 'GR-SEA-06' },
    { nameAr: 'كروڤات مشوي', nameFr: 'Crevettes Grillées', price: 2300, barcode: 'GR-SEA-07' },
    { nameAr: 'كلمار مشوي', nameFr: 'Calamars Grillés', price: 2500, barcode: 'GR-SEA-08' },
    { nameAr: 'فواكه البحر صوص', nameFr: 'Fruits de Mer Sauce', price: 2300, barcode: 'GR-SEA-09' },
    { nameAr: 'مشكل سمك شخص', nameFr: 'Plateau Poisson 1 Pers', price: 1600, barcode: 'GR-SEA-10' },
    { nameAr: 'مشكل سمك شخصين', nameFr: 'Plateau Poisson 2 Pers', price: 3600, barcode: 'GR-SEA-11' },
    { nameAr: 'مشكل سمك 4 أشخاص', nameFr: 'Plateau Poisson 4 Pers', price: 9500, barcode: 'GR-SEA-12' },
  ];

  const mainDishesProducts = [
    { nameAr: 'لوبيا', nameFr: 'Loubia', price: 250, barcode: 'GR-PLT-01' },
    { nameAr: 'عدس', nameFr: 'Lentilles', price: 250, barcode: 'GR-PLT-02' },
    { nameAr: 'أرز', nameFr: 'Riz Blanc', price: 250, barcode: 'GR-PLT-03' },
    { nameAr: 'أرز بالزبيب', nameFr: 'Riz aux Raisins Secs', price: 300, barcode: 'GR-PLT-04' },
    { nameAr: 'بولي فارسي', nameFr: 'Poulet Farci', price: 550, barcode: 'GR-PLT-05' },
    { nameAr: 'سكالوب الكريم', nameFr: 'Escalope à la Crème', price: 550, barcode: 'GR-PLT-06' },
    { nameAr: 'ستيك الكريم', nameFr: 'Steak à la Crème', price: 700, barcode: 'GR-PLT-07' },
    { nameAr: 'دجاج محمر', nameFr: 'Poulet Rôti', price: 400, barcode: 'GR-PLT-08' },
    { nameAr: 'بوزلوف', nameFr: 'Bouzelouf', price: 1000, barcode: 'GR-PLT-09' },
    { nameAr: 'بكبوكة', nameFr: 'Bakbouka', price: 800, barcode: 'GR-PLT-10' },
    { nameAr: 'مثوم', nameFr: 'Mthewem', price: 500, barcode: 'GR-PLT-11' },
    { nameAr: 'شطيطحة لحم', nameFr: 'Chtitha Viande', price: 800, barcode: 'GR-PLT-12' },
    { nameAr: 'شطيطحة داند', nameFr: 'Chtitha Dinde', price: 700, barcode: 'GR-PLT-13' },
    { nameAr: 'شطيطحة دجاج', nameFr: 'Chtitha Poulet', price: 550, barcode: 'GR-PLT-14' },
  ];

  const appetizerProducts = [
    { nameAr: 'حمص', nameFr: 'Houmous', price: 250, barcode: 'GR-APP-01' },
    { nameAr: 'شربة فريك', nameFr: 'Chorba Frik', price: 200, barcode: 'GR-APP-02' },
    { nameAr: 'حريرة', nameFr: 'Harira', price: 200, barcode: 'GR-APP-03' },
    { nameAr: 'حساء حوت', nameFr: 'Soupe de Poisson', price: 400, barcode: 'GR-APP-04' },
    { nameAr: 'حساء كروڤات', nameFr: 'Soupe aux Crevettes', price: 400, barcode: 'GR-APP-05' },
    { nameAr: 'سلطة', nameFr: 'Salade Verte', price: 300, barcode: 'GR-APP-06' },
    { nameAr: 'ميسدوان', nameFr: 'Macédoine', price: 300, barcode: 'GR-APP-07' },
    { nameAr: 'سيزار', nameFr: 'Salade César', price: 400, barcode: 'GR-APP-08' },
    { nameAr: 'سلطة طون', nameFr: 'Salade au Thon', price: 400, barcode: 'GR-APP-09' },
    { nameAr: 'سلطة جزائرية', nameFr: 'Salade Algérienne', price: 300, barcode: 'GR-APP-10' },
  ];

  const dessertProducts = [
    { nameAr: 'موس شوكولا', nameFr: 'Mousse au Chocolat', price: 300, barcode: 'GR-DES-01' },
    { nameAr: 'سلطة فواكه', nameFr: 'Salade de Fruits', price: 400, barcode: 'GR-DES-02' },
    { nameAr: 'فلان كراميل', nameFr: 'Flan Caramel', price: 200, barcode: 'GR-DES-03' },
    { nameAr: 'دلاع', nameFr: 'Pastèque', price: 200, barcode: 'GR-DES-04' },
    { nameAr: 'بطيخ', nameFr: 'Melon', price: 200, barcode: 'GR-DES-05' },
    { nameAr: 'تيراميسو', nameFr: 'Tiramisu', price: 300, barcode: 'GR-DES-06' },
    { nameAr: 'كرام برولي', nameFr: 'Crème Brûlée', price: 300, barcode: 'GR-DES-07' },
  ];

  const drinkProducts = [
    { nameAr: 'عصير كوكتال', nameFr: 'Jus Cocktail', price: 250, barcode: 'GR-DRK-01' },
    { nameAr: 'مشروب غازي علبة 33cl', nameFr: 'Canette Soda 33cl', price: 150, barcode: 'GR-DRK-02' },
    { nameAr: 'ماء معدني 0.5L', nameFr: 'Eau Minérale 0.5L', price: 80, barcode: 'GR-DRK-03' },
  ];

  const pizzaProducts = [
    { nameAr: 'بيتزا مارغوريت', nameFr: 'Pizza Margherita', priceL: 350, priceXL: 700, barcode: 'GR-PIZ-01' },
    { nameAr: 'بيتزا تونة', nameFr: 'Pizza au Thon', priceL: 400, priceXL: 800, barcode: 'GR-PIZ-02' },
    { nameAr: 'بيتزا دجاج', nameFr: 'Pizza Poulet', priceL: 400, priceXL: 800, barcode: 'GR-PIZ-03' },
    { nameAr: 'بيتزا لحم', nameFr: 'Pizza Viande', priceL: 500, priceXL: 1000, barcode: 'GR-PIZ-04' },
    { nameAr: 'بيتزا ثلاثة أجبان', nameFr: 'Pizza 3 Fromages', priceL: 600, priceXL: 1100, barcode: 'GR-PIZ-05' },
    { nameAr: 'بيتزا أربعة فصول', nameFr: 'Pizza 4 Saisons', priceL: 800, priceXL: 1500, barcode: 'GR-PIZ-06' },
    { nameAr: 'بيتزا خضروات', nameFr: 'Pizza Végétarienne', priceL: 600, priceXL: 1100, barcode: 'GR-PIZ-07' },
    { nameAr: 'بيتزا دجاج مدخن', nameFr: 'Pizza Poulet Fumé', priceL: 500, priceXL: 1000, barcode: 'GR-PIZ-08' },
    { nameAr: 'بيتزا لحم مدخن', nameFr: 'Pizza Viande Fumée', priceL: 600, priceXL: 1200, barcode: 'GR-PIZ-09' },
    { nameAr: 'بيتزا رويال', nameFr: 'Pizza Royale', priceL: 1000, priceXL: 2000, barcode: 'GR-PIZ-10' },
  ];

  db.transaction((tx) => {
    // 1. Upsert brand settings safely
    for (const s of settingsData) {
      tx.insert(restaurantSettings)
        .values(s)
        .onConflictDoUpdate({
          target: restaurantSettings.key,
          set: { value: s.value, updatedAt: new Date().toISOString() },
        })
        .run();
    }

    // 2. Non-destructive category upsert (preserves foreign keys & existing IDs)
    const catMap = new Map<string, number>();
    const activeCatNames: string[] = [];

    for (const cat of grineCategories) {
      activeCatNames.push(cat.nameAr);
      const existingCat = tx
        .select()
        .from(categories)
        .where(eq(categories.nameAr, cat.nameAr))
        .all();

      if (existingCat.length > 0) {
        tx.update(categories)
          .set({
            nameFr: cat.nameFr,
            nameEn: cat.nameEn,
            icon: cat.icon,
            color: cat.color,
            sortOrder: cat.sortOrder,
            station: cat.station,
            isActive: true,
          })
          .where(eq(categories.id, existingCat[0].id))
          .run();
        catMap.set(cat.nameAr, existingCat[0].id);
      } else {
        const inserted = tx
          .insert(categories)
          .values({ ...cat, isActive: true })
          .returning()
          .all();
        catMap.set(cat.nameAr, inserted[0].id);
      }
    }

    if (activeCatNames.length > 0) {
      tx.update(categories)
        .set({ isActive: false })
        .where(notInArray(categories.nameAr, activeCatNames))
        .run();
    }

    // 3. Upsert products safely without deleting historical rows referenced by orders/recipes
    const syncedProductIds: number[] = [];

    const upsertProduct = (item: {
      categoryId: number;
      nameAr: string;
      nameFr: string;
      price: number;
      barcode: string;
      station: string;
    }): number => {
      const byBarcode = item.barcode
        ? tx.select().from(products).where(eq(products.barcode, item.barcode)).all()
        : [];
      const existingProd =
        byBarcode.length > 0
          ? byBarcode[0]
          : tx.select().from(products).where(eq(products.nameAr, item.nameAr)).all()[0];

      const payload = {
        categoryId: item.categoryId,
        nameAr: item.nameAr,
        nameFr: item.nameFr,
        nameEn: item.nameAr,
        price: String(item.price),
        costPrice: String(Math.round(item.price * 0.4)),
        barcode: item.barcode,
        station: item.station,
        isAvailable: true,
        updatedAt: new Date().toISOString(),
      };

      if (existingProd) {
        tx.update(products).set(payload).where(eq(products.id, existingProd.id)).run();
        syncedProductIds.push(existingProd.id);
        return existingProd.id;
      }

      const inserted = tx.insert(products).values(payload).returning().all();
      syncedProductIds.push(inserted[0].id);
      return inserted[0].id;
    };

    const syncBatch = (
      items: { nameAr: string; nameFr: string; price: number; barcode: string }[],
      categoryName: string,
      station = 'MAIN_KITCHEN'
    ) => {
      const categoryId = catMap.get(categoryName)!;
      for (const item of items) {
        upsertProduct({
          categoryId,
          nameAr: item.nameAr,
          nameFr: item.nameFr,
          price: item.price,
          barcode: item.barcode,
          station,
        });
      }
    };

    syncBatch(tacosProducts, 'قسم الطاكوس');
    syncBatch(seafoodProducts, 'قسم المأكولات البحرية');
    syncBatch(mainDishesProducts, 'الأطباق الرئيسية');
    syncBatch(appetizerProducts, 'المقبلات');
    syncBatch(dessertProducts, 'التحلية', 'DESSERT');
    syncBatch(drinkProducts, 'المشروبات', 'DRINKS');

    const pizzaCatId = catMap.get('البيتزا')!;
    for (const p of pizzaProducts) {
      const prodId = upsertProduct({
        categoryId: pizzaCatId,
        nameAr: p.nameAr,
        nameFr: p.nameFr,
        price: p.priceL,
        barcode: p.barcode,
        station: 'MAIN_KITCHEN',
      });

      const xlDiff = p.priceXL - p.priceL;
      const desiredVariants = [
        { nameAr: 'حجم L', nameFr: 'Taille L', priceAdjustment: '0' },
        { nameAr: 'حجم XL', nameFr: 'Taille XL', priceAdjustment: String(xlDiff) },
      ];

      for (const v of desiredVariants) {
        const existingV = tx
          .select()
          .from(productVariants)
          .where(and(eq(productVariants.productId, prodId), eq(productVariants.nameAr, v.nameAr)))
          .all();
        if (existingV.length > 0) {
          tx.update(productVariants)
            .set({ nameFr: v.nameFr, priceAdjustment: v.priceAdjustment })
            .where(eq(productVariants.id, existingV[0].id))
            .run();
        } else {
          tx.insert(productVariants).values({ productId: prodId, ...v }).run();
        }
      }

      const desiredAddons = [
        { nameAr: 'صلصة بيضاء', nameFr: 'Sauce Blanche', price: '100.00' },
        { nameAr: 'فرماج', nameFr: 'Extra Fromage', price: '150.00' },
      ];

      for (const a of desiredAddons) {
        const existingA = tx
          .select()
          .from(productAddons)
          .where(and(eq(productAddons.productId, prodId), eq(productAddons.nameAr, a.nameAr)))
          .all();
        if (existingA.length > 0) {
          tx.update(productAddons)
            .set({ nameFr: a.nameFr, price: a.price })
            .where(eq(productAddons.id, existingA[0].id))
            .run();
        } else {
          tx.insert(productAddons).values({ productId: prodId, ...a }).run();
        }
      }
    }

    // Soft-hide non-Grine products instead of deleting rows referenced by historical orders
    if (syncedProductIds.length > 0) {
      tx.update(products)
        .set({ isAvailable: false, updatedAt: new Date().toISOString() })
        .where(notInArray(products.id, syncedProductIds))
        .run();
    }
  });

  console.log('--- Grine Restaurant Menu Synced Safely (Historical Orders Preserved) ---');
}

// Auto-run if executed directly via CLI
if (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1]?.endsWith('seedGrine.ts')) {
  seedGrineRestaurantMenu()
    .then(() => {
      console.log('Seeding script finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seeding error:', err);
      process.exit(1);
    });
}
