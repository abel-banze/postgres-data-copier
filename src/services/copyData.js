const { getTables } = require('./getTables');
const cliProgress = require('cli-progress');

// Definição dos valores válidos para cada enum
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

function getDefaultValueForEnum(enumType) {
  if (!ENUM_VALUES[enumType]) return null;
  return ENUM_VALUES[enumType][0]; // Retorna o primeiro valor do enum como padrão
}

function validateAndFixEnumValue(value, enumType) {
  if (!ENUM_VALUES[enumType]) return value;
  
  // Se o valor for válido, retorna ele mesmo
  if (ENUM_VALUES[enumType].includes(value)) return value;
  
  // Caso contrário, retorna o valor padrão
  console.warn(`Valor inválido para enum ${enumType}: ${value}. Usando valor padrão: ${ENUM_VALUES[enumType][0]}`);
  return ENUM_VALUES[enumType][0];
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

          for (const column of tableSchema) {
            const columnName = column.column_name;
            let value = row[columnName];

            // Tratamento especial para ENUMs
            if (column.data_type === 'USER-DEFINED') {
              const enumType = column.udt_name;
              if (ENUM_VALUES[enumType]) {
                value = validateAndFixEnumValue(value, enumType);
                if (column.is_nullable === 'NO' && value === null) {
                  value = getDefaultValueForEnum(enumType);
                }
              }
            }
            // Tratamento para arrays
            else if (column.data_type === 'ARRAY') {
              value = Array.isArray(value) ? value : (value ? [value] : []);
            }
            // Tratamento para campos não-nulos
            else if (column.is_nullable === 'NO' && value === null) {
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
                case 'timestamp with time zone':
                case 'timestamp without time zone':
                  value = new Date();
                  break;
              }
            }

            // Normalizar nomes das colunas timestamp
            if (columnName.toLowerCase() === 'createdat') {
              normalizedRow['createdAt'] = value || new Date();
            } else if (columnName.toLowerCase() === 'updateat') {
              normalizedRow['updatedAt'] = value || new Date();
            } else {
              normalizedRow[columnName] = value;
            }
          }

          const normalizedKeys = Object.keys(normalizedRow);
          const normalizedValues = Object.values(normalizedRow);

          // Criar query com cast explícito para enums
          const placeholders = normalizedKeys.map((key, i) => {
            const column = tableSchema.find(col => col.column_name === key);
            if (column && column.data_type === 'USER-DEFINED') {
              return `$${i + 1}::${column.udt_name}`;
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