const { PrismaClient } = require('../generated/source');

const prismaSource = new PrismaClient();

module.exports = { prismaSource };
