'use strict';

require('dotenv').config();
const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');

const clientId = process.env.CLIENT_ID;
if (!clientId) { console.error('Define CLIENT_ID en .env'); process.exit(1); }
const perms = new PermissionsBitField([
  P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory,
  P.ManageChannels, P.ManageRoles, P.ManageMessages,
]);
console.log(`https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${perms.bitfield}`);
