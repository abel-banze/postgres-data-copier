require('dotenv').config();
const { prismaSource } = require('./configs/prismaSource');
const { prismaDestination } = require('./configs/prismaDestination');
const { copyData } = require('./services/copyData');

(async () => {
  try {
    await copyData(prismaSource, prismaDestination);
  } catch (error) {
    console.error("Erro ao copiar os dados:", error);
  } finally {
    await prismaSource.$disconnect();
    await prismaDestination.$disconnect();
  }
})();
