// index.js
/**
 * Availability Bot - Render-ready version
 * - Discord.js v14
 * - Uses ONLY environment variables for sensitive data
 * - Persists only channelId/messageId to config.json
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  REST, Routes, SlashCommandBuilder, Client, GatewayIntentBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

// ---------- CONFIG & DATA ----------

// Load or create config.json (token is NEVER stored)
const CONFIG_PATH = path.join(__dirname, "config.json");
let fileConfig = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { fileConfig = {}; }
}

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID || fileConfig.guildId || ""
};

if (fileConfig.channelId) config.channelId = fileConfig.channelId;
if (fileConfig.messageId) config.messageId = fileConfig.messageId;

function saveConfigToFile() {
  const out = {
    guildId: config.guildId || "",
    channelId: config.channelId || "",
    messageId: config.messageId || ""
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 4));
}

// Load or create data.json
const DATA_PATH = path.join(__dirname, "data.json");
let data = {};
if (fs.existsSync(DATA_PATH)) {
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) || {}; }
  catch { data = {}; }
} else {
  fs.writeFileSync(DATA_PATH, JSON.stringify({}, null, 4));
}

function persistData() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 4));
}

function humanRemaining(seconds) {
  if (seconds <= 0) return "now";
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) {
    return `${hrs} hour${hrs === 1 ? "" : "s"}${rem ? ` ${rem}m` : ""}`;
  }
  return `${Math.floor(hrs / 24)} day(s)`;
}

// ---------- DISCORD CLIENT ----------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------- Slash Command Registration ----------

async function registerCommands() {
  if (!config.token || !config.guildId) {
    console.warn("Missing DISCORD_TOKEN or GUILD_ID; skipping command registration.");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("setupavailability")
      .setDescription("Creates the availability panel")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, config.guildId),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ---------- GUI Update ----------

async function updateAvailabilityGUI() {
  if (!config.channelId || !config.messageId) return;

  const channel = client.channels.cache.get(config.channelId);
  if (!channel) return;

  const message = await channel.messages.fetch(config.messageId).catch(() => null);
  if (!message) return;

  const now = Math.floor(Date.now() / 1000);
  const groups = {};

  for (const [id, entry] of Object.entries(data)) {
    const remaining = entry.expires - now;
    if (remaining <= 0) continue;

    const game = entry.game || "Any";
    if (!groups[game]) groups[game] = [];
    groups[game].push({ id, entry, remaining });
  }

  const gameNames = Object.keys(groups).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  let description = "";

  if (gameNames.length === 0) {
    description = "No one is currently available.";
  } else {
    for (const game of gameNames) {
      groups[game].sort((a, b) => a.remaining - b.remaining);
      description += `**${game}**\n`;
      for (const u of groups[game]) {
        const ts = `<t:${u.entry.expires}:t>`;
        const human = humanRemaining(u.remaining);
        description += `<@${u.id}> — Available to ${ts} (in ${human})\n`;
      }
      description += "\n";
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("Availability")
    .setDescription(description.trim())
    .setColor(0x00aaff)
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("manage_menu")
      .setLabel("Manage My Availability")
      .setStyle(ButtonStyle.Primary)
  );

  await message.edit({ embeds: [embed], components: [buttons] });
}

// ---------- READY EVENT ----------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  if (config.channelId && config.messageId) {
    await updateAvailabilityGUI();
  }
});

// ---------- LOGIN ----------

if (!config.token) {
  console.error("DISCORD_TOKEN is missing. Set it in Render → Environment.");
  process.exit(1);
}

client.login(config.token).catch(err => {
  console.error("Failed to login:", err);
  process.exit(1);
});

// ---------- INTERACTION HANDLERS ----------

client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user?.id;
  if (!userId) return;

  try {
    // --- Slash Command ---
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setupavailability") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("manage_menu")
            .setLabel("Manage My Availability")
            .setStyle(ButtonStyle.Primary)
        );

        const embed = new EmbedBuilder()
          .setTitle("Availability")
          .setDescription("No one is currently available.")
          .setColor(0x00aaff);

        const msg = await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        config.channelId = interaction.channel.id;
        config.messageId = msg.id;
        saveConfigToFile();

        return interaction.reply({ content: "Availability panel created!", ephemeral: true });
      }
    }

    // --- Buttons ---
    if (interaction.isButton()) {
      if (interaction.customId === "manage_menu") {
        const isAvailable = !!data[userId];

        if (!isAvailable) {
          return interaction.reply({
            content: "You are not currently available.",
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId("set_availability")
                  .setLabel("Set Availability")
                  .setStyle(ButtonStyle.Primary)
              )
            ],
            ephemeral: true
          });
        }

        const entry = data[userId];
        return interaction.reply({
          content: `You're available for **${entry.game}** until <t:${entry.expires}:t>`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("change_game").setLabel("Change Game").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("change_time").setLabel("Change Time").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("remove_availability").setLabel("Remove Availability").setStyle(ButtonStyle.Danger)
            )
          ],
          ephemeral: true
        });
      }

      // Set availability modal
      if (interaction.customId === "set_availability") {
        const modal = new ModalBuilder()
          .setCustomId("availability_modal")
          .setTitle("Set Your Availability");

        const gameInput = new TextInputBuilder()
          .setCustomId("game_input")
          .setLabel("Game")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const durationInput = new TextInputBuilder()
          .setCustomId("duration_input")
          .setLabel("Duration (minutes)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(gameInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        return interaction.showModal(modal);
      }

      // Remove availability
      if (interaction.customId === "remove_availability") {
        delete data[userId];
        persistData();
        await updateAvailabilityGUI();
        return interaction.reply({ content: "Your availability has been removed.", ephemeral: true });
      }

      // Change game modal
      if (interaction.customId === "change_game") {
        const modal = new ModalBuilder()
          .setCustomId("change_game_modal")
          .setTitle("Change Game");

        const gameInput = new TextInputBuilder()
          .setCustomId("new_game_input")
          .setLabel("New Game")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(gameInput));
        return interaction.showModal(modal);
      }

      // Change time modal
      if (interaction.customId === "change_time") {
        const modal = new ModalBuilder()
          .setCustomId("change_time_modal")
          .setTitle("Change Availability Time");

        const durationInput = new TextInputBuilder()
          .setCustomId("new_duration_input")
          .setLabel("Duration (minutes)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
        return interaction.showModal(modal);
      }
    }

    // --- Modal Submit ---
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "availability_modal") {
        const game = interaction.fields.getTextInputValue("game_input");
        const dur = parseInt(interaction.fields.getTextInputValue("duration_input"));
        if (isNaN(dur) || dur <= 0) return interaction.reply({ content: "Invalid duration.", ephemeral: true });

        const expires = Math.floor(Date.now() / 1000) + dur * 60;
        data[userId] = { game, expires };
        persistData();
        await updateAvailabilityGUI();

        return interaction.reply({
          content: `Availability set for **${game}** until <t:${expires}:t>`,
          ephemeral: true
        });
      }

      if (interaction.customId === "change_game_modal") {
        const newGame = interaction.fields.getTextInputValue("new_game_input");
        data[userId].game = newGame;
        persistData();
        await updateAvailabilityGUI();

        return interaction.reply({
          content: `Your game has been changed to **${newGame}**.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "change_time_modal") {
        const dur = parseInt(interaction.fields.getTextInputValue("new_duration_input"));
        if (isNaN(dur) || dur <= 0) return interaction.reply({ content: "Invalid duration.", ephemeral: true });

        const expires = Math.floor(Date.now() / 1000) + dur * 60;
        data[userId].expires = expires;
        persistData();
        await updateAvailabilityGUI();

        return interaction.reply({
          content: `Your availability has been updated to <t:${expires}:t>.`,
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error("Interaction handler error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Error occurred.", ephemeral: true });
    }
  }
});

// ---------- Auto-clear expired ----------

setInterval(async () => {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;

  for (const uid of Object.keys(data)) {
    if (data[uid].expires <= now) {
      delete data[uid];
      changed = true;
    }
  }

  if (changed) {
    persistData();
    await updateAvailabilityGUI();
  }
}, 60_000);

// ---------- Express Keep-Alive (Render uses this) ----------

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Availability bot running on Render."));
app.listen(process.env.PORT || 3000, () =>
  console.log("Web server ready.")
);
