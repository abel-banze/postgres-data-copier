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

        // Renomear colunas createdat/updateat para createdAt/updatedAt, se necessário
        const normalizedRow = {};
        for (const key of Object.keys(row)) {
          if (key.toLowerCase() === 'createdat') {
            normalizedRow['createdAt'] = row[key];
          } else if (key.toLowerCase() === 'updateat') {
            normalizedRow['updatedAt'] = row[key];
          } else {
            normalizedRow[key] = row[key];
          }
        }

        // Preparar chaves e valores para a inserção
        const normalizedKeys = Object.keys(normalizedRow);
        const normalizedValues = Object.values(normalizedRow);

        // Criação da query com `ON CONFLICT`
        const placeholders = normalizedKeys.map((_, i) => `$${i + 1}`).join(', ');
        const conflictKeys = normalizedKeys.includes('id') ? 'id' : normalizedKeys[0]; // Assume que a chave primária seja `id`
        const insertQuery = `
          INSERT INTO "${table}" (${normalizedKeys.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT (${conflictKeys}) DO NOTHING
        `;

        try {
          await prismaDestination.$executeRawUnsafe(insertQuery, ...normalizedValues);
        } catch (error) {
          console.error(`Erro ao inserir na tabela ${table}:`, error.message);
        }

        // Atualiza a barra de progresso
        progressBar.increment();
      }

      // Finaliza a barra de progresso para a tabela atual
      progressBar.stop();
      console.log(`Tabela ${table}: ${data.length} registros processados com sucesso.`);
    } else {
      console.log(`Tabela ${table}: sem dados para copiar.`);
    }
  }

  console.log("Cópia concluída com sucesso.");
}

module.exports = { copyData };
