require('dotenv/config');

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const ytdl = require('ytdl-core');
const youtubeSearchApi = require('youtube-search-api');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let queue = [];
let connection;
let player;

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function refreshSpotifyToken() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log('Spotify access token refreshed');
    } catch (error) {
        console.error('Error refreshing Spotify access token:', error);
    }
}

// Refresh the token immediately and then every hour
refreshSpotifyToken();
setInterval(refreshSpotifyToken, 3600 * 1000);

client.once('ready', () => {
    console.log('Ready!');
    client.user.setPresence({
        activities: [{
            name: '!play',
            type: ActivityType.Listening,
        }],
        status: 'dnd',
    });
});

const commands = {
    '!play': handlePlayCommand,
    '!p': handlePlayCommand,
    '!skip': handleSkipCommand,
    '!s': handleSkipCommand,
    '!pause': handlePauseCommand,
    '!resume': handleResumeCommand,
    '!stop': handleStopCommand,
    '!queue': handleQueueCommand,
    '!q': handleQueueCommand
};

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (commands[command]) {
        commands[command](message, args);
    }
});

async function handlePlayCommand(message, args) {
    const query = args.slice(1).join(' ');

    if (!query) {
        message.channel.send('Please provide a song name or YouTube/Spotify URL.');
        return;
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send('You need to be in a voice channel to play music!');
        return;
    }

    let url;
    if (ytdl.validateURL(query)) {
        url = query;
    } else if (query.includes('open.spotify.com/track')) {
        const spotifyTrack = await getSpotifyTrack(query);
        if (spotifyTrack) {
            url = await searchYouTube(spotifyTrack);
            if (!url) {
                message.channel.send('No results found on YouTube.');
                return;
            }
        } else {
            message.channel.send('No results found on Spotify.');
            return;
        }
    } else {
        url = await searchYouTube(query);
        if (!url) {
            message.channel.send('No results found on YouTube.');
            return;
        }
    }

    if (!connection) {
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        player = createAudioPlayer();

        player.on(AudioPlayerStatus.Idle, () => {
            queue.shift();
            if (queue.length > 0) {
                playSong(queue[0], message);
            } else {
                if (connection) connection.destroy();
                connection = null;
                player = null;
                message.channel.send('Finished playing!');
            }
        });

        player.on('error', error => {
            console.error('Error:', error);
            message.channel.send('An error occurred while trying to play the audio.');
            if (connection) connection.destroy();
            connection = null;
            player = null;
        });

        connection.subscribe(player);
    }

    queue.push(url);
    if (queue.length === 1) {
        playSong(url, message);
    } else {
        message.channel.send('Added to the queue.');
    }
}

function handleSkipCommand(message) {
    if (player && connection) {
        player.stop();
        message.channel.send('Skipped the current song.');
    } else {
        message.channel.send('No song is currently playing.');
    }
}

function handlePauseCommand(message) {
    if (player && connection) {
        player.pause();
        message.channel.send('Paused the music.');
    } else {
        message.channel.send('No song is currently playing.');
    }
}

function handleResumeCommand(message) {
    if (player && connection) {
        player.unpause();
        message.channel.send('Resumed the music.');
    } else {
        message.channel.send('No song is currently playing.');
    }
}

function handleStopCommand(message) {
    if (player && connection) {
        player.stop();
        queue = [];
        if (connection) connection.destroy();
        connection = null;
        player = null;
        message.channel.send('Stopped the music and cleared the queue.');
    } else {
        message.channel.send('No song is currently playing.');
    }
}

function handleQueueCommand(message) {
    if (queue.length === 0) {
        message.channel.send('The queue is currently empty.');
    } else {
        const queueMessage = queue.map((url, index) => `${index + 1}. ${url}`).join('\n');
        message.channel.send(`Current queue:\n${queueMessage}`);
    }
}

async function getSpotifyTrack(url) {
    const trackId = url.split('track/')[1].split('?')[0];
    try {
        const data = await spotifyApi.getTrack(trackId);
        return `${data.body.artists[0].name} - ${data.body.name}`;
    } catch (error) {
        console.error('Error fetching Spotify track:', error);
        return null;
    }
}

async function searchYouTube(query) {
    try {
        const result = await youtubeSearchApi.GetListByKeyword(query, false);
        if (result.items.length > 0) {
            return `https://www.youtube.com/watch?v=${result.items[0].id}`;
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error searching YouTube:', error);
        return null;
    }
}

function playSong(url, message) {
    const stream = ytdl(url, {
        filter: 'audioonly',
        highWaterMark: 1 << 25,
        quality: 'highestaudio',
    });

    const resource = createAudioResource(stream);
    player.play(resource);
    message.channel.send('Now playing');
}

client.login(process.env.TOKEN);
