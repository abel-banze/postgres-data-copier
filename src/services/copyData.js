const { getTables } = require('./getTables');

async function copyData(prismaSource, prismaDestination) {
  console.log("Obtendo tabelas do banco de dados de origem...");
  const tables = await getTables(prismaSource);

  console.log(`Tabelas encontradas: ${tables.join(', ')}`);

  for (const table of tables) {
    console.log(`Copiando dados da tabela: ${table}`);
    const data = await prismaSource.$queryRawUnsafe(`SELECT * FROM "${table}"`);

    if (data.length > 0) {
      console.log(`Copiando ${data.length} registros da tabela ${table}...`);
      const placeholders = Object.keys(data[0])
        .map((_, i) => `$${i + 1}`)
        .join(', ');

      const query = `INSERT INTO "${table}" (${Object.keys(data[0]).join(', ')}) VALUES (${placeholders})`;

      for (const row of data) {
        const values = Object.values(row);
        await prismaDestination.$executeRawUnsafe(query, ...values);
      }
      console.log(`Tabela ${table}: ${data.length} registros copiados com sucesso.`);
    } else {
      console.log(`Tabela ${table}: sem dados para copiar.`);
    }
  }

  console.log("Cópia concluída com sucesso.");
}

module.exports = { copyData };
