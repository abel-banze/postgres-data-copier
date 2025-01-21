async function getTables(prisma) {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    return tables.map((t) => t.table_name);
  }
  
  module.exports = { getTables };
  