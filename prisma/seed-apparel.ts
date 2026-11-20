import { PrismaClient } from '@prisma/client';
import { DEFAULT_RULE_PRESETS, DEFAULT_TEMPLATES } from '../src/modules/apparel/apparel-defaults';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding apparel templates and rule presets...');

  // 1. Préréglages sportifs (FOOTBALL_MEN, FOOTBALL_WOMEN, FFF, FIBA, NBA, FREE)
  for (const preset of DEFAULT_RULE_PRESETS) {
    await prisma.rulePreset.upsert({
      where: { code: preset.code },
      create: {
        code: preset.code,
        name: preset.name,
        rules: preset.rules as object,
      },
      update: {
        name: preset.name,
        rules: preset.rules as object,
      },
    });
    console.log(`  - Rule preset: ${preset.code} (${preset.name})`);
  }

  // 2. 5 Gabarits de référence (T-shirt, Polo, Maillot Football, Maillot Basketball, Short)
  for (const template of DEFAULT_TEMPLATES) {
    const existing = await prisma.apparelTemplate.findFirst({
      where: { name: template.name, category: template.category },
    });

    if (existing) {
      await prisma.apparelTemplate.update({
        where: { id: existing.id },
        data: {
          description: template.description,
          material: template.material,
          sizes: template.sizes as unknown as object,
          zones: template.zones as unknown as object,
        },
      });
      console.log(`  - Template updated: ${template.name} (${template.category})`);
    } else {
      await prisma.apparelTemplate.create({
        data: {
          category: template.category,
          name: template.name,
          description: template.description,
          material: template.material,
          sizes: template.sizes as unknown as object,
          zones: template.zones as unknown as object,
        },
      });
      console.log(`  - Template created: ${template.name} (${template.category})`);
    }
  }

  console.log('Apparel seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
