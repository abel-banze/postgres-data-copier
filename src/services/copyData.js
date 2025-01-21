const { getTables } = require('./getTables');
const cliProgress = require('cli-progress');

const ENUM_VALUES = {
  UserRole: ['ADMIN', 'GUEST', 'MANAGER', 'EDITOR'],
  DocumentType: ['MODELO', 'FORMULARIO', 'GUIA', 'MANUAL', 'FILE'],
  NewsCategory: ['COMPANY', 'INDUSTRY', 'TECHNOLOGY', 'GENERAL', 'ANNOUNCEMENT'],
  NewsStatus: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  EventType: ['CONFERENCE', 'WORKSHOP', 'WEBINAR', 'MEETING', 'SOCIAL', 'TRAINING', 'OTHER'],
  EventStatus: ['DRAFT', 'PUBLISHED', 'ARCHIVED']
};

async function getTableSchema(prisma, table) {
  const query = `
    SELECT 
      column_name, 
      is_nullable, 
      data_type, 
      udt_name,
      column_default
    FROM information_schema.columns 
    WHERE table_name = $1
    ORDER BY ordinal_position;
  `;
  return await prisma.$queryRawUnsafe(query, table);
}

function validateAndFixEnumValue(value, enumType) {
  if (!ENUM_VALUES[enumType]) return value;
  if (ENUM_VALUES[enumType].includes(value)) return value;
  return ENUM_VALUES[enumType][0];
}

function getCurrentTimestamp() {
  return new Date();
}

async function copyData(prismaSource, prismaDestination) {
  try {
    console.log("Obtendo tabelas do banco de dados de origem...");
    const tables = await getTables(prismaSource);
    console.log(`Tabelas encontradas: ${tables.join(', ')}`);

    for (const table of tables) {
      console.log(`Copiando dados da tabela: ${table}`);
      
      const tableSchema = await getTableSchema(prismaSource, table);
      const data = await prismaSource.$queryRawUnsafe(`SELECT * FROM "${table}"`);

      if (data.length > 0) {
        console.log(`Copiando ${data.length} registros da tabela ${table}...`);
        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(data.length, 0);

        for (let index = 0; index < data.length; index++) {
          const row = data[index];
          const normalizedRow = {};
          const currentTimestamp = getCurrentTimestamp();

          for (const column of tableSchema) {
            const columnName = column.column_name;
            let value = row[columnName];

            // Tratamento especial para timestamps
            if (column.data_type.includes('timestamp')) {
              if (value === null || value === undefined) {
                value = currentTimestamp;
              } else if (typeof value === 'string') {
                value = new Date(value);
              }
            }
            // Tratamento para ENUMs
            else if (column.data_type === 'USER-DEFINED') {
              const enumType = column.udt_name;
              if (ENUM_VALUES[enumType]) {
                value = validateAndFixEnumValue(value, enumType);
              }
            }
            // Tratamento para arrays
            else if (column.data_type === 'ARRAY') {
              value = Array.isArray(value) ? value : (value ? [value] : []);
            }
            // Tratamento para campos não-nulos
            else if (column.is_nullable === 'NO' && value === null) {
              if (column.data_type === 'USER-DEFINED') {
                const enumType = column.udt_name;
                value = ENUM_VALUES[enumType][0];
              } else {
                switch (column.data_type) {
                  case 'character varying':
                  case 'text':
                    value = '';
                    break;
                  case 'integer':
                  case 'bigint':
                    value = 0;
                    break;
                  case 'boolean':
                    value = false;
                    break;
                }
              }
            }

            normalizedRow[columnName] = value;
          }

          // Usando Prisma para criar registros
          try {
            await prismaDestination[table].create({
              data: normalizedRow
            });
          } catch (error) {
            console.error(`Erro ao inserir na tabela ${table} (registro ${index + 1}/${data.length}):`, error.message);
            console.error('Dados da linha:', normalizedRow);
          }

          progressBar.increment();
        }

        progressBar.stop();
        console.log(`Tabela ${table}: ${data.length} registros processados com sucesso.`);
      } else {
        console.log(`Tabela ${table}: sem dados para copiar.`);
      }
    }

    console.log("Cópia concluída com sucesso.");
  } catch (error) {
    console.error("Erro durante a cópia dos dados:", error);
    throw error;
  }
}

module.exports = { copyData };
