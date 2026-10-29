'use strict';

const { PermissionFlagsBits } = require('discord.js');

function memberHasAnyRole(member, roleIds) {
  if (!member || !roleIds || !roleIds.length) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roleIds.some((id) => roles.includes(id));
  if (roles && roles.cache) return roleIds.some((id) => roles.cache.has(id));
  return false;
}

// Niveles: admin (Administrador/Gestionar servidor/propietario o rol administrativo) ⊃ reviewer (rol revisor).
function getAccess(interaction, config) {
  const perms = interaction.memberPermissions;
  const owner = interaction.guild?.ownerId === interaction.user.id;
  const superAdmin = owner || !!perms?.has(PermissionFlagsBits.Administrator) || !!perms?.has(PermissionFlagsBits.ManageGuild);
  const admin = superAdmin || memberHasAnyRole(interaction.member, config?.admin_roles);
  const reviewer = admin || memberHasAnyRole(interaction.member, config?.reviewer_roles);
  return { admin, reviewer };
}

module.exports = { getAccess, memberHasAnyRole };
