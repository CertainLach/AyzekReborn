import type { ArgumentType } from "@ayzek/command-parser/arguments";
import StringReader from "@ayzek/command-parser/reader";
import { Api } from "@ayzek/model/api";
import type { Attachment, Image } from "@ayzek/model/attachment";
import { Chat, Conversation, Gender, User } from "@ayzek/model/conversation";
import { MessageEvent } from "@ayzek/model/events/message";
import type ApiFeature from "@ayzek/model/features";
import type { IMessage, IMessageOptions } from "@ayzek/model/message";
import type { Text } from "@ayzek/text";
import type { MaybePromise } from "@meteor-it/utils";
import { splitByMaxPossibleParts } from "@ayzek/core/util/split";
import XRest from "@meteor-it/xrest";
import * as https from 'https';

export class TelegramUser extends User<TelegramApi>{
	constructor(public apiUser: any, api: TelegramApi) {
		super(
			api,
			apiUser.id.toString(),
			`TGU:${api.descriptor}:${apiUser.id.toString()}`,
			apiUser.username,
			apiUser.first_name ?? null,
			apiUser.last_name ?? null,
			apiUser.is_bot ? Gender.BOT : Gender.UNSPECIFIED,
			`https://t.me/${apiUser.username}`,
			apiUser.is_bot,
		)
	}
	get photoImage(): Promise<Image | null> {
		throw new Error("Method not implemented.");
	}
}
export class TelegramChat extends Chat<TelegramApi>{
	constructor(public apiChat: any, api: TelegramApi) {
		super(
			api,
			apiChat.id,
			`TGC:${api.descriptor}:${-apiChat.id}`,
			[],
			apiChat.title,
			[],
			null,
		);
	}

	get photoImage(): Promise<Image | null> {
		throw new Error("Method not implemented.");
	}
}

function isChatType(type: string) {
	if (!type) return;
	return ['group', 'supergroup'].includes(type);
}

export default class TelegramApi extends Api<TelegramApi>{
	xrest: XRest;
	constructor(public descriptor: string, public username: string, public token: string) {
		super('tg');
		this.xrest = new XRest(`https://api.telegram.org/bot${token}/`, {
			agent: new https.Agent({
				keepAlive: true,
				keepAliveMsecs: 5000,
				maxSockets: Infinity,
				maxFreeSockets: 256,
			})
		});
	}
	protected supportedFeatures: Set<ApiFeature> = new Set();

	getUser(uid: string): MaybePromise<TelegramUser | null> {
		const userPrefix = `TGU:${this.descriptor}:`;
		if (!uid.startsWith(userPrefix)) {
			return null;
		}
		const id = parseInt(uid.replace(userPrefix, ''), 10);
		if (isNaN(id))
			return null;
		if (this.users.has(id))
			return this.users.get(id)!;

		return this.fetchUserOrChat(id) as Promise<TelegramUser>;
	}
	async fetchUserOrChat(id: number): Promise<TelegramUser | TelegramChat | null> {
		const got = await this.execute('getChat', { chat_id: id });
		if (id > 0) {
			this.updateUserMap(got);
			return this.users.get(id) ?? null;
		} else {
			this.updateChatMap(got);
			return this.chats.get(-id) ?? null;
		}
	}
	getChat(cid: string): MaybePromise<TelegramChat | null> {
		const chatPrefix = `TGC:${this.descriptor}:`;
		if (!cid.startsWith(chatPrefix)) {
			return Promise.resolve(null);
		}
		let id = -parseInt(cid.replace(chatPrefix, ''), 10);
		if (isNaN(id))
			return Promise.resolve(null);
		if (this.chats.has(id))
			return this.chats.get(id)!;
		return this.fetchUserOrChat(id) as Promise<TelegramChat>;
	}
	public async execute(method: string, params: any): Promise<any> {
		const res = await this.xrest.emit('POST', method, {
			// multipart: true,
			data: params,
		});
		const data = res.jsonBody;
		if (!data.ok) {
			throw new Error(data.description);
		}
		return data.result;
	}

	lastUpdateId: number = 0;

	users: Map<number, TelegramUser> = new Map();
	chats: Map<number, TelegramChat> = new Map();

	updateUserMap(user: any) {
		if (!this.users.get(user.id)) {
			this.users.set(user.id, new TelegramUser(user, this));
		} else {
			// TODO: Update
		}
	}

	updateChatMap(chat: any) {
		if (!chat.id) {
			this.logger.debug('No id:', chat);
			return;
		}
		if (!this.chats.get(-chat.id)) {
			this.chats.set(-chat.id, new TelegramChat(chat, this));
		} else {
			// TODO: Update
		}
	}

	async parseForwarded(message: any): Promise<IMessage<TelegramApi>[]> {
		if (!message.forward_from) return [];
		if (message.forward_from)
			this.updateUserMap(message.forward_from);
		if (isChatType(message.forward_from_chat.type))
			this.updateChatMap(message.forward_from_chat);
		const user = this.users.get(message.forward_from.id)!;
		const chat = this.chats.get(-message.forward_from_chat.id) ?? null;
		return [{
			api: this,
			user,
			chat,
			conversation: chat ?? user,
			attachments: [],
			text: message.text ?? message.caption,
			replyTo: message.reply_to_message ? (await this.parseMessage(message.reply_to_message)) : null,
			forwarded: [],
			messageId: message.forward_from_message_id,
		}];
	}

	async parseMessage(message: any): Promise<MessageEvent<TelegramApi>> {
		if (message.from)
			this.updateUserMap(message.from);
		if (isChatType(message.chat.type))
			this.updateChatMap(message.chat);
		const user = this.users.get(message.from.id)!;
		const chat = this.chats.get(-message.chat.id) ?? null;
		const isForwarded = !!message.forwarded_from;
		// TODO: Group multiple forwarded at api level?
		return new MessageEvent(
			this,
			user,
			chat,
			chat ?? user,
			[],
			isForwarded ? '' : (message.text ?? message.caption),
			await this.parseForwarded(message),
			message.message_id,
			message.reply_to_message ? (await this.parseMessage(message.reply_to_message)) : null,
		);
	}
	async processMessageUpdate(messageUpdate: any) {
		const message = await this.parseMessage(messageUpdate);
		this.messageEvent.emit(message);
	}
	async processUpdate(update: any) {
		this.logger.debug(update);
		if (update.message) {
			await this.processMessageUpdate(update.message);
		}
	}
	async doWork() {
		while (true) {
			try {
				const data = await this.execute('getUpdates', {
					offset: this.lastUpdateId,
					timeout: 5,
					allowed_updates: [],
				});
				if (data.length !== 0) {
					this.lastUpdateId = data[data.length - 1].update_id + 1;
					for (const update of data) {
						await this.processUpdate(update);
					}
				}
			} catch (e) {
				if (e.message === 'Unauthorized') {
					this.logger.error('Bad token');
					return;
				}
				this.logger.error('Update processing failure');
				this.logger.error(e);
			}
		}
	}
	get apiLocalUserArgumentType(): ArgumentType<void, User<TelegramApi>> {
		throw new Error("Method not implemented.");
	}

	async send(conv: Conversation<TelegramApi>, text: Text, _attachments: Attachment[], _options: IMessageOptions): Promise<void> {
		const parts = splitByMaxPossibleParts(this.transformText(text), 4096);
		for (let part of parts) {
			await this.execute('sendMessage', {
				chat_id: conv.targetId,
				text: part,
				parseMode: 'MarkdownV2',
				disable_web_page_preview: true,
				disable_notification: true,
			});
		}
	}
	transformText(text: Text): string {
		if (!text) return '';
		if (typeof text === 'number') {
			return text + '';
		} else if (typeof text === 'string') return text;
		if (Array.isArray(text)) return text.map(this.transformText.bind(this)).join('');
		if (text instanceof StringReader) return text.toString();
		switch (text.type) {
			case 'boldPart':
				return this.transformText(text.data);
			case 'chatRefPart':
				return `<Чат ${text.data.title}>`;
			case 'preservingWhitespace':
				return this.transformText(text.data).replace(/(:?^ |  )/g, e => '\u2002'.repeat(e.length));
			case 'code':
				return `\`${this.transformText(text.data)}\``;
			case 'hashTagPart':
				return this.transformText(text.data).split(' ').map(e => e.length !== 0 ? `#${e}` : e).join(' ');
			case 'mentionPart':
				return `[${text.text ?? text.data.name}](tg://user?id=${text.data.targetId})`;
			case 'underlinedPart':
				return `_${this.transformText(text.data)}_`;
		}
		throw new Error(`Part ${JSON.stringify(text)} not handled`);
	}
}