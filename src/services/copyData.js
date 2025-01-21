const { getTables } = require('./getTables');
const cliProgress = require('cli-progress'); // Biblioteca para a barra de progresso

async function copyData(prismaSource, prismaDestination) {
  console.log("Obtendo tabelas do banco de dados de origem...");
  const tables = await getTables(prismaSource);

  console.log(`Tabelas encontradas: ${tables.join(', ')}`);

  for (const table of tables) {
    console.log(`Copiando dados da tabela: ${table}`);
    const data = await prismaSource.$queryRawUnsafe(`SELECT * FROM "${table}"`);

    if (data.length > 0) {
      console.log(`Copiando ${data.length} registros da tabela ${table}...`);

      // Inicializa a barra de progresso para a tabela atual
      const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      progressBar.start(data.length, 0);

      for (let index = 0; index < data.length; index++) {
        const row = data[index];

        // Verificar se o registro já existe no banco de destino
        const keys = Object.keys(row);
        const values = Object.values(row);

        const conditions = keys
          .map((key, i) => `"${key}" = $${i + 1}`)
          .join(' AND ');

        const existsQuery = `SELECT 1 FROM "${table}" WHERE ${conditions} LIMIT 1`;
        const exists = await prismaDestination.$queryRawUnsafe(existsQuery, ...values);

        if (exists.length > 0) {
          progressBar.increment(); // Atualiza a barra mesmo se pular o registro
          continue; // Pula a inserção deste registro
        }

        // Renomear colunas createdat/updateat para createdAt/updatedAt, se necessário
        const normalizedRow = {};
        for (const key of keys) {
          if (key === 'createdat') {
            normalizedRow['createdAt'] = row[key];
          } else if (key === 'updateat') {
            normalizedRow['updatedAt'] = row[key];
          } else {
            normalizedRow[key] = row[key];
          }
        }

        // Inserir o registro no banco de destino
        const normalizedKeys = Object.keys(normalizedRow);
        const normalizedValues = Object.values(normalizedRow);

        const placeholders = normalizedKeys.map((_, i) => `$${i + 1}`).join(', ');
        const insertQuery = `INSERT INTO "${table}" (${normalizedKeys.join(', ')}) VALUES (${placeholders})`;

        await prismaDestination.$executeRawUnsafe(insertQuery, ...normalizedValues);

        // Atualiza a barra de progresso
        progressBar.increment();
      }

      // Finaliza a barra de progresso para a tabela atual
      progressBar.stop();
      console.log(`Tabela ${table}: ${data.length} registros copiados com sucesso.`);
    } else {
      console.log(`Tabela ${table}: sem dados para copiar.`);
    }
  }

  console.log("Cópia concluída com sucesso.");
}

module.exports = { copyData };
