const { 
    REST, Routes, SlashCommandBuilder, Client, GatewayIntentBits, 
    InteractionResponseFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const fs = require("fs");
const config = require("./config.json");
let data = require("./data.json");

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Register slash commands
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName("setupavailability")
            .setDescription("Creates the availability panel")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(config.token);
    await rest.put(
        Routes.applicationGuildCommands(client.user.id, config.guildId),
        { body: commands }
    );

    console.log("Commands registered.");
}

// Update the permanent GUI embed
async function updateAvailabilityGUI() {
    const channel = client.channels.cache.get(config.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(config.messageId).catch(() => null);
    if (!message) return;

    const availableUsers = Object.entries(data)
        .map(([id, entry]) => `<@${id}> — **${entry.game}** until <t:${entry.expires}:F>`)
        .join("\n") || "No one is currently available.";

    const newEmbed = new EmbedBuilder()
        .setTitle("Availability")
        .setDescription(availableUsers)
        .setColor(0x00aaff);

    const mainButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("manage_menu")
            .setLabel("Manage My Availability")
            .setStyle(ButtonStyle.Primary)
    );

    await message.edit({
        embeds: [newEmbed],
        components: [mainButtons]
    });
}

// Ready event
client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();
});

// Login bot
client.login(config.token);

// Unified interaction handler
client.on("interactionCreate", async interaction => {
    const userId = interaction.user.id;

    try {
        // Handle slash commands
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

                const message = await interaction.channel.send({
                    embeds: [embed],
                    components: [row]
                });

                config.channelId = interaction.channel.id;
                config.messageId = message.id;
                fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));

                return interaction.reply({
                    content: "Availability panel created!",
                    ephemeral: true
                });
            }
        }

        if (interaction.isButton()) {
            const userId = interaction.user.id;

            // Manage My Availability
            if (interaction.customId === "manage_menu") {
                const isAvailable = data[userId] !== undefined;

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
                    content: `You're available for **${entry.game}** until <t:${entry.expires}:F>`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId("change_game")
                                .setLabel("Change Game")
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId("change_time")
                                .setLabel("Change Time")
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId("remove_availability")
                                .setLabel("Remove Availability")
                                .setStyle(ButtonStyle.Danger)
                        )
                    ],
                    ephemeral: true
                });
            }

            // Set availability (modal)
            if (interaction.customId === "set_availability") {
                const modal = new ModalBuilder()
                    .setCustomId("availability_modal")
                    .setTitle("Set Your Availability");

                const gameInput = new TextInputBuilder()
                    .setCustomId("game_input")
                    .setLabel("Game")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Minecraft, Rocket League, Fortnite...")
                    .setRequired(true);

                const durationInput = new TextInputBuilder()
                    .setCustomId("duration_input")
                    .setLabel("Duration (minutes)")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("60")
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(gameInput),
                    new ActionRowBuilder().addComponents(durationInput)
                );

                return interaction.showModal(modal);
            }

            // Remove availability
            if (interaction.customId === "remove_availability") {
                if (data[userId]) {
                    delete data[userId];
                    fs.writeFileSync("./data.json", JSON.stringify(data, null, 4));
                    await updateAvailabilityGUI();
                    return interaction.reply({ content: "Your availability has been removed.", ephemeral: true });
                } else {
                    return interaction.reply({ content: "You are not currently available.", ephemeral: true });
                }
            }

            // Change game
            if (interaction.customId === "change_game") {
                const modal = new ModalBuilder()
                    .setCustomId("change_game_modal")
                    .setTitle("Change Your Game");

                const gameInput = new TextInputBuilder()
                    .setCustomId("new_game_input")
                    .setLabel("New Game")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Minecraft, Rocket League, Fortnite...")
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(gameInput));
                return interaction.showModal(modal);
            }

            // Change time
            if (interaction.customId === "change_time") {
                const modal = new ModalBuilder()
                    .setCustomId("change_time_modal")
                    .setTitle("Change Your Availability Time");

                const durationInput = new TextInputBuilder()
                    .setCustomId("new_duration_input")
                    .setLabel("Duration (minutes)")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("60")
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
                return interaction.showModal(modal);
            }
        }


        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            if (interaction.customId === "availability_modal") {
                const game = interaction.fields.getTextInputValue("game_input");
                const durationMinutes = parseInt(interaction.fields.getTextInputValue("duration_input"));

                if (isNaN(durationMinutes) || durationMinutes <= 0) {
                    return interaction.reply({ content: "Invalid duration.", ephemeral: true });
                }

                const expires = Math.floor(Date.now() / 1000) + durationMinutes * 60;

                data[userId] = { game, expires };
                fs.writeFileSync("./data.json", JSON.stringify(data, null, 4));

                await interaction.reply({
                    content: `Availability set for **${game}** until <t:${expires}:F>`,
                    ephemeral: true
                });

                await updateAvailabilityGUI();
            }
        }
    } catch (err) {
        console.error("Error handling interaction:", err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "An error occurred.", ephemeral: true });
        }
    }
});

// Auto-clear expired availability every minute
setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    let changed = false;

    for (const userId in data) {
        if (data[userId].expires <= now) {
            delete data[userId];
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync("./data.json", JSON.stringify(data, null, 4));
        await updateAvailabilityGUI();
    }
}, 60000);
