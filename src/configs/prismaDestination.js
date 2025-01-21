const { PrismaClient } = require('../generated/destination');

const prismaDestination = new PrismaClient();

module.exports = { prismaDestination };
