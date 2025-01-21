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
    console.log("Fetching tables from source database...");
    const tables = await getTables(prismaSource);
    console.log(`Tables found: ${tables.join(', ')}`);

    for (const table of tables) {
      console.log(`Processing table: ${table}`);
      
      const tableSchema = await getTableSchema(prismaSource, table);
      const data = await prismaSource.$queryRawUnsafe(`SELECT * FROM "${table}"`);

      if (data.length > 0) {
        console.log(`Copying ${data.length} records from ${table}...`);
        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(data.length, 0);

        // Create enum types first
        const enumTypes = new Set();
        const arrayColumns = new Map();

        for (const column of tableSchema) {
          if (column.data_type === 'USER-DEFINED' && column.udt_name in ENUM_VALUES) {
            enumTypes.add(column.udt_name);
          }
          if (column.data_type === 'ARRAY') {
            const arrayType = column.udt_name.replace(/^_/, '');
            arrayColumns.set(column.column_name, arrayType);
          }
        }

        // Create enum types if they don't exist
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
            console.log(`Enum type ${enumType} already exists: ${error.message}`);
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

            // Handle timestamps
            if (column.data_type.includes('timestamp')) {
              if (value === null || value === undefined) {
                value = currentTimestamp;
              } else if (typeof value === 'string') {
                value = new Date(value);
              }
            }
            // Handle enums
            else if (column.data_type === 'USER-DEFINED') {
              const enumType = column.udt_name;
              if (ENUM_VALUES[enumType]) {
                value = validateAndFixEnumValue(value, enumType);
              }
            }
            // Handle arrays
            else if (column.data_type === 'ARRAY') {
              if (Array.isArray(value)) {
                // Convert array to PostgreSQL array literal
                value = `{${value.map(v => `"${v}"`).join(',')}}`;
              } else {
                value = '{}';
              }
            }
            // Handle non-nullable fields
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
                default:
                  value = '';
              }
            }

            normalizedRow[columnName] = value;
          }

          const normalizedKeys = Object.keys(normalizedRow);
          const normalizedValues = Object.values(normalizedRow);

          // Build placeholders with proper casting
          const placeholders = normalizedKeys.map((key, i) => {
            const column = tableSchema.find(col => col.column_name === key);
            
            if (column.data_type.includes('timestamp')) {
              return `$${i + 1}::timestamp`;
            }
            if (column.data_type === 'USER-DEFINED') {
              return `$${i + 1}::"${column.udt_name}"`;
            }
            if (column.data_type === 'ARRAY') {
              const arrayType = arrayColumns.get(key);
              return `$${i + 1}::${arrayType}[]`;
            }
            return `$${i + 1}`;
          }).join(', ');

          const conflictKey = normalizedKeys.includes('id') ? 'id' : normalizedKeys[0];
          
          const insertQuery = `
            INSERT INTO "${table}" (${normalizedKeys.map(key => `"${key}"`).join(', ')})
            VALUES (${placeholders})
            ON CONFLICT ("${conflictKey}") DO UPDATE SET
            ${normalizedKeys.map(key => `"${key}" = EXCLUDED."${key}"`).join(', ')}
          `;

          try {
            await prismaDestination.$executeRawUnsafe(insertQuery, ...normalizedValues);
          } catch (error) {
            console.error(`Error inserting into ${table} (record ${index + 1}/${data.length}):`, error.message);
            console.error('Problematic row:', normalizedRow);
            console.error('Generated query:', insertQuery);
            throw error; // Stop execution on critical errors
          }

          progressBar.increment();
        }

        progressBar.stop();
        console.log(`${table}: Successfully processed ${data.length} records.`);
      } else {
        console.log(`${table}: No data to copy.`);
      }
    }

    console.log("Data copy completed successfully.");
  } catch (error) {
    console.error("Fatal error during data copy:", error);
    throw error;
  }
}

module.exports = { copyData };