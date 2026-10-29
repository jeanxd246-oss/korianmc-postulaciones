# KorianMC Postulaciones

Bot de Discord (Node.js + discord.js v14 + SQLite) para gestionar las postulaciones al equipo de KorianMC. Una única postulación evalúa Minecraft y Discord. Multiservidor, configurable con comandos slash.

## 1. Requisitos
- Node.js 18.17 o superior (recomendado 20/22).
- Una aplicación de bot en https://discord.com/developers/applications

## 2. Instalar dependencias
```bash
npm install
```
`better-sqlite3` es opcional: si no se puede compilar en el hosting y usas Node 22.5+, el bot usa `node:sqlite` automáticamente.

## 3. Configurar el token
```bash
cp .env.example .env
```
Rellena `DISCORD_TOKEN` (Bot > Reset Token) y `CLIENT_ID` (General Information > Application ID). En un hosting, define estas variables en su panel de variables de entorno en lugar de subir `.env`. **Nunca compartas el token.**

`DATABASE_PATH` debe apuntar a una carpeta **persistente** del hosting (por defecto `./data/korianmc-postulaciones.sqlite`).

## 4. Intents
Solo se usa el intent `Guilds`. **No hay que activar ningún intent privilegiado** (ni Message Content ni Server Members).

## 5. Registrar los slash commands
```bash
npm run deploy
```
Con `DEV_GUILD_ID` se registran solo en ese servidor (instantáneo); sin él son globales (pueden tardar hasta 1 h). También puedes poner `AUTO_DEPLOY_COMMANDS=true` para registrarlos al arrancar.

## 6. Invitar el bot
```bash
npm run invite
```
Imprime el enlace con los permisos necesarios: Ver canales, Enviar mensajes, Insertar enlaces, Adjuntar archivos, Leer historial, Gestionar canales, Gestionar roles (necesario para los permisos privados de cada ticket) y Gestionar mensajes. El rol del bot debe estar **por encima** de los roles de revisores/administración y con acceso a la categoría de tickets.

## 7. Iniciar
```bash
npm start        # equivale a: node src/index.js
```
En FadeHost u otro hosting Node.js: sube el proyecto (sin `node_modules`), ejecuta `npm install`, define las variables y usa `node src/index.js` como comando de inicio.

## 8. Primera configuración en Discord (solo administradores)
1. `/postulaciones configurar categoria` — categoría de los tickets.
2. `/postulaciones configurar revisores` — rol(es) revisor(es); `administradores` para administración.
3. `/postulaciones configurar logs` — canal de registros.
4. (Opcional) `/postulaciones configurar revision` — canal privado del equipo donde se publica el expediente con observaciones e historial.
5. `/postulaciones requisitos agregar` — los requisitos que decidas (no hay ninguno por defecto).
6. `/postulaciones preguntas listar|agregar|editar|eliminar|mover` — las preguntas (hay un conjunto inicial editable).
7. `/postulaciones configurar textos` — personaliza los textos del panel, bienvenida, aceptación y rechazo.
8. `/postulaciones panel` — publica el panel.

Administran quienes tengan Administrador/Gestionar servidor, o un rol administrativo configurado. Revisan quienes tengan un rol revisor.

## 9. Comandos
`panel`, `configurar` (`ver`, `categoria`, `logs`, `revision`, `revisores`, `administradores`, `cierre`, `notificaciones`, `textos`), `requisitos` (`listar`, `agregar`, `editar`, `eliminar`), `preguntas` (`listar`, `agregar`, `editar`, `eliminar`, `mover`, `restablecer`), `revisar`, `ver`, `aceptar`, `rechazar`, `estado`, `cerrar`, `reabrir`, `añadir`, `quitar`, `estadísticas`, `exportar`, `ayuda`.
`id` = número del expediente (`#0012` → `12`). Dentro de un ticket, `id` es opcional.

## 10. Copias de seguridad
```bash
npm run backup
```
Crea una copia consistente en `data/backups/` (funciona con el bot en marcha). Descarga esa carpeta periódicamente fuera del hosting. Para restaurar: detén el bot y sustituye el archivo de `DATABASE_PATH` por la copia.

## 11. Verificación
```bash
npm run check   # comprueba comandos, manejadores, botones, base de datos y embeds
npm test        # pruebas de base de datos y de flujo completo (con objetos simulados)
```

## Estructura
```
src/index.js            arranque
src/commands/           comandos slash (postulaciones/: definición + manejadores)
src/events/             eventos de Discord
src/handlers/           carga de comandos/eventos, registro y errores
src/interactions/       botones y formularios (modales)
src/services/           lógica de negocio (postulaciones, revisión, tickets, logs, mantenimiento)
src/database/           SQLite, migraciones y repositorio
src/utils/              embeds, componentes, permisos, validación
src/config/             constantes, textos y preguntas por defecto
```

## Notas de diseño
- Los botones se identifican por ID en la base de datos: siguen funcionando tras reiniciar y los botones antiguos se rechazan si el estado cambió.
- Las preguntas se copian a cada postulación al iniciarla: editar las preguntas no altera postulaciones en curso.
- Los tickets cerrados pueden eliminarse automáticamente (`configurar cierre`); las postulaciones sin completar se cierran a las 72 h.
- Si el MD al postulante falla, se registra en el canal de logs y el proceso continúa.
