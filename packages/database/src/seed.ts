/**
 * Development fixtures. Every store and product created here is flagged `isFixture`
 * and shown as "Demo" in the UI. Refuses to run against production.
 *
 * Payout addresses are the well-known Anvil dev accounts 5–9, so local end-to-end
 * tests can observe settlements. They hold no value on any public network.
 */
import { prisma } from "./index";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_FIXTURES !== "true") {
  console.error("Refusing to seed fixtures in production.");
  process.exit(1);
}

const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&q=80&auto=format&fit=crop`;

const ANVIL = [
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
];

type P = {
  title: string;
  category: string;
  price: number; // USD
  floor?: number; // USD, enables negotiation
  stock: number;
  images: string[];
  description: string;
  specs: Record<string, string>;
  delivery?: "PHYSICAL" | "DIGITAL";
  featured?: boolean;
  assets?: ("USDG" | "ETH")[];
};

const STORES: { slug: string; name: string; tagline: string; description: string; verified: boolean; policy: string; products: P[] }[] = [
  {
    slug: "atelier-optics",
    name: "Atelier Optics",
    tagline: "Inspected, graded cameras and lenses with a 30-day return window.",
    description: "Every body is shutter-count tested and sensor-cleaned before listing. Grades follow a published A–C scale.",
    verified: true,
    policy: "30-day returns on all cameras in original condition. Buyer pays return shipping unless the item was misdescribed.",
    products: [
      { title: "Full-frame DSLR body, grade A", category: "Cameras", price: 1240, floor: 1150, stock: 3, images: [img("1516035069371-29a1b244cc32"), img("1502920917128-1aa500764cbd")], description: "A full-frame DSLR body in grade A condition with 8,400 shutter actuations. Sensor cleaned, firmware current. Includes battery, charger and strap.", specs: { Sensor: "Full frame, 24 MP", Shutter: "8,400 actuations", Condition: "Grade A", Mount: "F-mount" }, featured: true },
      { title: "APS-C kit with 18–55mm lens", category: "Cameras", price: 640, floor: 580, stock: 5, images: [img("1502920917128-1aa500764cbd")], description: "Lightweight APS-C body with a stabilised 18–55mm kit lens. A good first serious camera.", specs: { Sensor: "APS-C, 24 MP", Lens: "18–55mm f/3.5–5.6", Condition: "Grade A−" } },
      { title: "Instant film camera, cream", category: "Cameras", price: 129, stock: 12, images: [img("1526170375885-4d8ecf77b99f")], description: "Analogue instant camera with automatic exposure and a built-in flash. Takes standard instant film packs.", specs: { Format: "Instant film", Flash: "Built-in", Condition: "New" }, featured: true },
      { title: "Mirrorless body with prime-lens set", category: "Cameras", price: 1890, floor: 1760, stock: 2, images: [img("1564466809058-bf4114d55352")], description: "Mirrorless body bundled with 35mm and 85mm primes. Lightly used, grade A.", specs: { Sensor: "Full frame, 33 MP", Lenses: "35mm f/1.8, 85mm f/1.8", Condition: "Grade A" } },
    ],
  },
  {
    slug: "northlight-supply",
    name: "Northlight Supply",
    tagline: "Considered audio and personal tech.",
    description: "A small catalogue of headphones, computers and phones we use ourselves. Everything ships within two business days.",
    verified: true,
    policy: "14-day returns on unopened items. Opened electronics can be returned if faulty.",
    products: [
      { title: "Over-ear wireless headphones", category: "Audio", price: 279, floor: 249, stock: 14, images: [img("1505740420928-5e560c06d30e")], description: "Closed-back wireless headphones with active noise cancellation and 30-hour battery life.", specs: { Battery: "30 h", ANC: "Yes", Connectivity: "Bluetooth 5.3, USB-C" }, featured: true },
      { title: "Studio monitor headphones", category: "Audio", price: 169, stock: 9, images: [img("1583394838336-acd977736f90")], description: "Wired studio headphones tuned flat for mixing. Detachable cable.", specs: { Impedance: "38 Ω", Driver: "45 mm", Cable: "Detachable, 3 m" } },
      { title: "14-inch laptop, 16 GB / 512 GB", category: "Computers", price: 1149, floor: 1069, stock: 4, images: [img("1496181133206-80ce9b88a853"), img("1593642632559-0c6d3fc62b89")], description: "Refurbished 14-inch laptop with a bright display, 16 GB memory and a 512 GB SSD. Battery health 94%.", specs: { Display: "14-inch, 3024×1964", Memory: "16 GB", Storage: "512 GB SSD", "Battery health": "94%", Condition: "Refurbished, grade A" }, featured: true },
      { title: "Desktop workstation, 27-inch", category: "Computers", price: 1599, stock: 2, images: [img("1593642632559-0c6d3fc62b89")], description: "All-in-one 27-inch desktop for creative work. Includes keyboard and trackpad.", specs: { Display: "27-inch 5K", Memory: "32 GB", Storage: "1 TB SSD" } },
      { title: "Smartphone, 256 GB, lavender", category: "Phones", price: 699, floor: 650, stock: 6, images: [img("1610945265064-0e34e5519bbf")], description: "Unlocked smartphone with a 6.2-inch display and triple camera. New, sealed.", specs: { Storage: "256 GB", Display: "6.2-inch OLED", Unlocked: "Yes" } },
    ],
  },
  {
    slug: "fieldwork-goods",
    name: "Fieldwork Goods",
    tagline: "Everyday carry and accessories, made to be used.",
    description: "Bags, eyewear and footwear from independent makers.",
    verified: false,
    policy: "30-day returns on unworn items.",
    products: [
      { title: "Classic acetate sunglasses", category: "Accessories", price: 145, stock: 20, images: [img("1572635196237-14b3f281503f")], description: "Hand-polished acetate frames with polarised lenses.", specs: { Lens: "Polarised, UV400", Frame: "Acetate" } },
      { title: "Round wire-frame sunglasses", category: "Accessories", price: 165, stock: 11, images: [img("1511499767150-a48a237f0083")], description: "Lightweight gold wire frames with green mineral glass lenses.", specs: { Lens: "Mineral glass", Frame: "Gold-tone steel" }, featured: true },
      { title: "Daypack, 18 L, navy", category: "Bags", price: 120, floor: 105, stock: 15, images: [img("1553062407-98eeb64c6a62")], description: "Water-resistant daypack with a padded laptop sleeve and magnetic closures.", specs: { Volume: "18 L", Laptop: "Up to 15-inch", Material: "Recycled nylon" } },
      { title: "Canvas market tote", category: "Bags", price: 48, stock: 40, images: [img("1544816155-12df9643f363")], description: "Heavyweight waxed canvas tote with leather handles.", specs: { Material: "Waxed canvas", Handles: "Vegetable-tanned leather" } },
      { title: "Suede derby shoes, green", category: "Footwear", price: 210, floor: 190, stock: 7, images: [img("1560343090-f0409e92791a")], description: "Goodyear-welted suede derbies with a crepe sole.", specs: { Upper: "Suede", Sole: "Crepe", Construction: "Goodyear welt" } },
      { title: "Knit running shoes", category: "Footwear", price: 135, stock: 18, images: [img("1491553895911-0055eca6402d")], description: "Breathable knit trainers with a responsive foam midsole.", specs: { Upper: "Engineered knit", Drop: "8 mm" } },
    ],
  },
  {
    slug: "maison-calder",
    name: "Maison Calder",
    tagline: "Furniture and objects for quiet rooms.",
    description: "Small-batch furniture from European workshops, delivered by white-glove courier.",
    verified: true,
    policy: "Returns within 14 days of delivery; a collection fee applies to large items.",
    products: [
      { title: "Three-seat sofa, terracotta", category: "Home", price: 2450, floor: 2250, stock: 2, images: [img("1567016432779-094069958ea5")], description: "Deep-seated sofa upholstered in terracotta bouclé on a solid oak frame.", specs: { Width: "218 cm", Fabric: "Bouclé", Frame: "Solid oak" }, featured: true },
      { title: "Oak ladder-back chair", category: "Home", price: 340, stock: 8, images: [img("1506439773649-6e0eb8cfb237")], description: "A traditional ladder-back chair in oiled oak with a woven seat.", specs: { Wood: "Oiled oak", Seat: "Paper cord" } },
      { title: "Painted wooden stool", category: "Home", price: 95, stock: 16, images: [img("1503602642458-232111445657")], description: "Simple four-leg stool in soft white paint. Doubles as a side table.", specs: { Height: "62 cm", Finish: "Water-based paint" } },
    ],
  },
  {
    slug: "hour-and-hand",
    name: "Hour & Hand",
    tagline: "Wristwatches, serviced and guaranteed.",
    description: "Pre-owned and new watches. Every movement is serviced before sale.",
    verified: false,
    policy: "12-month movement guarantee. 14-day returns.",
    products: [
      { title: "Minimal white smartwatch", category: "Watches", price: 229, stock: 10, images: [img("1523275335684-37898b6baf30")], description: "Round smartwatch with heart-rate, sleep tracking and a week of battery.", specs: { Case: "42 mm", Battery: "7 days", Water: "5 ATM" } },
      { title: "Field watch, automatic", category: "Watches", price: 480, floor: 440, stock: 4, images: [img("1532667449560-72a95c8d381b")], description: "38 mm automatic field watch with a steel bracelet. Serviced 2026.", specs: { Movement: "Automatic", Case: "38 mm steel", Service: "2026" }, featured: true },
    ],
  },
  {
    slug: "common-grounds",
    name: "Common Grounds Roastery",
    tagline: "Single-origin coffee and brewing courses.",
    description: "We roast twice a week and ship the next morning. Courses are delivered digitally.",
    verified: false,
    policy: "Coffee is non-returnable once opened. Course access can be refunded within 7 days if unused.",
    products: [
      { title: "Ethiopia Guji, 250 g whole bean", category: "Coffee", price: 22, stock: 60, images: [img("1559056199-641a0ac8b55e")], description: "Washed Guji with notes of bergamot, peach and black tea.", specs: { Process: "Washed", Roast: "Light", Weight: "250 g" } },
      { title: "Home barista course (online)", category: "Courses", price: 89, stock: 500, images: [img("1495474472287-4d71bcdd2085")], description: "Six video lessons on espresso, milk texture and latte art. Lifetime access link delivered by email after payment.", specs: { Lessons: "6", Length: "3 h 40 min", Access: "Lifetime" }, delivery: "DIGITAL", assets: ["USDG", "USDC"] },
    ],
  },
];

async function main() {
  const existing = await prisma.store.count({ where: { isFixture: true } });
  if (existing > 0 && process.argv[2] !== "--reset") {
    console.log(`Fixtures already present (${existing} stores). Use --reset to recreate.`);
    return;
  }
  if (existing > 0) {
    await prisma.store.deleteMany({ where: { isFixture: true } });
  }

  for (const [i, s] of STORES.entries()) {
    const address = ANVIL[i % ANVIL.length].toLowerCase();
    const wallet = await prisma.wallet.findUnique({ where: { address } });
    const user = wallet
      ? await prisma.user.findUniqueOrThrow({ where: { id: wallet.userId } })
      : await prisma.user.create({ data: { displayName: `${s.name} (demo)`, wallets: { create: { address } } } });
    const merchant = await prisma.merchant.upsert({
      where: { userId: user.id },
      create: { userId: user.id, verified: s.verified, verifiedAt: s.verified ? new Date() : null },
      update: { verified: s.verified },
    });
    const store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        slug: s.slug,
        name: s.name,
        tagline: s.tagline,
        description: s.description,
        payoutAddress: ANVIL[i % ANVIL.length],
        returnPolicy: s.policy,
        isFixture: true,
      },
    });
    for (const p of s.products) {
      await prisma.product.create({
        data: {
          storeId: store.id,
          title: p.title,
          slug: p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          description: p.description,
          category: p.category,
          priceCents: p.price * 100,
          floorPriceCents: p.floor ? p.floor * 100 : null,
          negotiable: Boolean(p.floor),
          images: p.images,
          specs: p.specs,
          acceptedAssets: p.assets ?? ["USDG", "ETH", "USDC", "BNB"],
          deliveryType: p.delivery ?? "PHYSICAL",
          shippingInfo: p.delivery === "DIGITAL" ? "Delivered digitally after payment is confirmed." : "Ships in 2 business days. Tracked delivery.",
          featured: Boolean(p.featured),
          isFixture: true,
          inventory: { create: { available: p.stock } },
        },
      });
    }
    // Every negotiable store gets a seller agent bound to its merchant-set floors.
    if (s.products.some((p) => p.floor)) {
      await prisma.agent.create({
        data: {
          ownerId: user.id,
          name: `${s.name} sales agent`,
          type: "SELLER",
          description: "Answers buyer questions and negotiates within the floor prices set on each listing.",
          storeId: store.id,
        },
      });
    }
    console.log(`seeded ${s.name}: ${s.products.length} products`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
