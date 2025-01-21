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

        // Primeiro, vamos criar os tipos enum necessários
        const enumTypes = new Set();
        for (const column of tableSchema) {
          if (column.data_type === 'USER-DEFINED' && column.udt_name in ENUM_VALUES) {
            enumTypes.add(column.udt_name);
          }
        }

        // Criar tipos enum se não existirem
        for (const enumType of enumTypes) {
          try {
            const createEnumQuery = `
              DO $$ 
              BEGIN 
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumType.toLowerCase()}') THEN
                  CREATE TYPE "${enumType}" AS ENUM (${ENUM_VALUES[enumType].map(v => `'${v}'`).join(', ')});
                END IF;
              END $$;
            `;
            await prismaDestination.$executeRawUnsafe(createEnumQuery);
          } catch (error) {
            console.log(`Tipo enum ${enumType} já existe ou não pode ser criado:`, error.message);
          }
        }

        for (let index = 0; index < data.length; index++) {
          const row = data[index];
          const normalizedRow = {};
          const columnTypes = {};

          const currentTimestamp = getCurrentTimestamp();

          for (const column of tableSchema) {
            const columnName = column.column_name;
            let value = row[columnName];
            columnTypes[columnName] = column.data_type;

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

          const normalizedKeys = Object.keys(normalizedRow);
          const normalizedValues = Object.values(normalizedRow);

          // Construir placeholders com os casts apropriados
          const placeholders = normalizedKeys.map((key, i) => {
            const column = tableSchema.find(col => col.column_name === key);
            if (column.data_type.includes('timestamp')) {
              return `$${i + 1}::timestamp`;
            } else if (column.data_type === 'USER-DEFINED') {
              return `$${i + 1}::${column.udt_name}`;
            } else if (column.data_type === 'ARRAY') {
              return `$${i + 1}::${column.udt_name}[]`;
            }
            return `$${i + 1}`;
          }).join(', ');

          const conflictKeys = normalizedKeys.includes('id') ? 'id' : normalizedKeys[0];
          
          const insertQuery = `
            INSERT INTO "${table}" (${normalizedKeys.map(key => `"${key}"`).join(', ')})
            VALUES (${placeholders})
            ON CONFLICT ("${conflictKeys}") DO UPDATE SET
            ${normalizedKeys.map((key, i) => `"${key}" = EXCLUDED."${key}"`).join(', ')}
          `;

          try {
            await prismaDestination.$executeRawUnsafe(insertQuery, ...normalizedValues);
          } catch (error) {
            console.error(`Erro ao inserir na tabela ${table} (registro ${index + 1}/${data.length}):`, error.message);
            console.error('Dados da linha:', normalizedRow);
            console.error('Query:', insertQuery);
            console.error('Valores:', normalizedValues);
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