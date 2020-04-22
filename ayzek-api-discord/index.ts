import StringReader from "@ayzek/command-parser/reader";
import { Api } from "@ayzek/model/api";
import { splitByMaxPossibleParts } from '@ayzek/core/util/split';
import { Attachment, BaseFile, File } from "@ayzek/model/attachment";
import type { Conversation } from "@ayzek/model/conversation";
import { JoinGuildEvent, JoinReason } from "@ayzek/model/events/join";
import { LeaveGuildEvent, LeaveReason } from "@ayzek/model/events/leave";
import { MessageEvent } from "@ayzek/model/events/message";
import { TypingEvent, TypingEventType } from "@ayzek/model/events/typing";
import ApiFeature from "@ayzek/model/features";
import type { IMessageOptions } from "@ayzek/model/message";
import type { Text, TextPart } from "@ayzek/text";
import { lookupByPath } from '@meteor-it/mime';
import * as assert from 'assert';
import { Client, Guild, GuildMember, MessageAttachment, TextChannel, User } from "discord.js";
import { DSUserArgumentType } from './arguments';
import DiscordChat from "./chat";
import DiscordGuild from "./guild";
import DiscordUser from "./user";

const MAX_MESSAGE_LENGTH = 2000;

export default class DiscordApi extends Api<DiscordApi> {

	api: Client;
	token: string;
	private userPrefix: string;
	private chatPrefix: string;
	private guildPrefix: string;

	constructor(public apiId: string, token: string) {
		super('ds');
		this.api = new Client();
		this.token = token;
		this.userPrefix = `DSU:${apiId}:`;
		this.chatPrefix = `DSC:${apiId}:`;
		this.guildPrefix = `DSG:${apiId}:`;
	}

	encodeUserUid(uid: string): string {
		return `${this.userPrefix}${uid}`;
	}

	encodeChatUid(cid: string): string {
		return `${this.chatPrefix}${cid}`;
	}

	encodeGuildGid(gid: string): string {
		return `${this.guildPrefix}${gid}`;
	}

	wrapGuild(guild: Guild): DiscordGuild {
		return new DiscordGuild(this, guild);
	}

	wrapUser(user: User): DiscordUser {
		return new DiscordUser(this, user);
	}

	wrapMember(member: GuildMember): DiscordUser {
		return this.wrapUser(member.user);
	}

	private extractMembers(chat: any): DiscordUser[] {
		let members = chat.members;
		if (members) {
			return members.map((u: User) => this.wrapUser(u));
		}
		let recipients = chat.recipients;
		if (recipients) {
			return recipients.map((u: User) => this.wrapUser(u));
		}
		return [this.wrapUser(chat.recipient)];
	}

	wrapChat(chat: any): DiscordChat {
		let members = this.extractMembers(chat);
		return new DiscordChat(this, this.wrapGuild(chat.guild), chat, [], members); // TODO fill one last parameter
	}

	async getApiUser(id: string): Promise<DiscordUser | null> {
		try {
			return this.wrapUser(await this.api.users.fetch(id, true));
		} catch (e) {
			this.logger.error(e.stack);
			return null;
		}
	}

	async getApiChat(id: string): Promise<DiscordChat> {
		return this.wrapChat(this.api.channels.fetch(id));
	}

	getUser(uid: string): Promise<DiscordUser | null> {
		if (!uid.startsWith(this.userPrefix)) {
			return Promise.resolve(null);
		}
		const id = uid.replace(this.userPrefix, '');
		return this.getApiUser(id);
	}

	getChat(cid: string): Promise<DiscordChat | null> {
		if (!cid.startsWith(this.chatPrefix)) {
			return Promise.resolve(null);
		}
		const id = cid.replace(this.chatPrefix, '');
		return this.getApiChat(id);
	}

	parseAttachments(attachments: MessageAttachment[]): Attachment[] {
		return attachments.map(a => {
			let filename = a.name || '';
			return File.fromUrlWithSizeKnown(
				'GET',
				a.url,
				{},
				a.size,
				filename,
				lookupByPath(filename) || ''
			);
		});
	}

	async init() {
		this.api.login(this.token);
		this.api.on('guildMemberAdd', async member => {
			this.joinGuildEvent.emit(new JoinGuildEvent(
				this,
				this.wrapMember(await member.fetch()),
				null,
				JoinReason.INVITE_LINK,
				null,
				this.wrapGuild(member.guild)
			));
		});
		this.api.on('guildMemberRemove', async member => {
			this.leaveGuildEvent.emit(new LeaveGuildEvent(
				this,
				this.wrapMember(await member.fetch()),
				null,
				LeaveReason.SELF,
				null,
				this.wrapGuild(member.guild)
			));
		});
		this.api.on('message', message => {
			if (message.author === this.api.user) return;
			const chat = message.channel.type === 'dm' ? null : this.wrapChat(message.channel);
			const user = this.wrapUser(message.author);
			this.messageEvent.emit(new MessageEvent(
				this,
				user,
				chat,
				chat || user,
				this.parseAttachments(message.attachments.array()),
				message.content,
				[],
				message.id,
				null
			));
		});
		this.api.on('typingStart', async (ch, apiUser) => {
			const chat = ch.type === 'dm' ? null : this.wrapChat(ch);
			const user = this.wrapUser(await apiUser.fetch());
			this.typingEvent.emit(new TypingEvent(
				this,
				user,
				chat,
				chat || user,
				TypingEventType.WRITING_TEXT
			));
		})
	}

	async send(conv: Conversation<DiscordApi>, text: Text, attachments: Attachment[] = [], _options: IMessageOptions = {}) {
		const textParts = splitByMaxPossibleParts(this.textToString(text), MAX_MESSAGE_LENGTH);
		const chat = await this.api.channels.fetch(conv.targetId) as TextChannel;
		if (!chat) throw new Error(`Bad channel: ${conv.targetId}`);
		const uploadPromises: [Promise<Buffer>, string][] = attachments.map(a => {
			if (a.type === 'location' || a.type === 'messenger_specific')
				throw new Error('Unsupported attachment type for discord: ' + a.type);
			const file = a as BaseFile;
			return [file.data.toBuffer(), file.name];
		});
		const partsToSentBeforeAttachments = (textParts.length - (attachments.length === 0 ? 0 : 1));
		for (let i = 0; i < partsToSentBeforeAttachments; i++) {
			await chat.send(textParts.shift());
		}
		if (attachments.length !== 0) {
			for (let i = 0; i < uploadPromises.length; i++) {
				const file = uploadPromises[i];
				await chat.send(i === 0 ? textParts.shift() : undefined, new MessageAttachment(await file[0], file[1]));
			}
		}
		assert.equal(textParts.length, 0, 'Text parts left unsent');
	}

	textToString(part: TextPart): string {
		if (!part) return part + '';
		if (typeof part === 'number') {
			return part + '';
		} else if (typeof part === 'string')
			return part
				.replace(/`/g, '\\`')
				.replace(/_/g, '\\_');
		if (part instanceof StringReader) {
			return `${part.toStringWithCursor(`|`)}`
		} else if (part instanceof Array) {
			return part.map(l => this.textToString(l)).join('');
		}
		switch (part.type) {
			case 'preservingWhitespace':
				return this.textToString(part.data).replace(/(:?^ |  )/g, e => '\u2002'.repeat(e.length));
			case 'code':
				// TODO: Multiline comments
				return `\`${this.textToString(part.data)}\``;
			case 'mentionPart':
				return `<@${(part.data as any as DiscordUser).apiUser.id}>`;
			case 'chatRefPart':
				return `<#${part.data.targetId}>`;
			case 'underlinedPart':
				return `__${this.textToString(part.data)}__`;
			case 'boldPart':
				return `**${this.textToString(part.data)}**`;
			case 'hashTagPart':
				if (part.hideOnNoSupport) return '';
				return this.textToString(part.data);
		}
		throw new Error(`Part ${JSON.stringify(part)} not handled`);
	}

	async doWork(): Promise<void> {
		await this.init();
	}

	apiLocalUserArgumentType = new DSUserArgumentType(this);

	supportedFeatures = new Set([
		ApiFeature.IncomingMessageWithMultipleAttachments,
		ApiFeature.OutgoingMessageWithMultipleAttachments,
		ApiFeature.GuildSupport,
		ApiFeature.MessageReactions
	]);
}