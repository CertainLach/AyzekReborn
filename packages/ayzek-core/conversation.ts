import { AttributeStorage, ownerlessEmptyAttributeStorage } from '@ayzek/attribute';
import { Translation, Text, TextPart } from '@ayzek/text';
import type { Api } from './api';
import type { IMessage, IMessageOptions } from './message';
import { Attachment, Image } from './model/attachment';
import { ayzekToOpaque } from './text';

enum ConversationType {
	USER,
	CHAT,
	OTHER
}

export interface IConversation {
	// TODO: Edit message?
	send(text: Text, attachments?: Attachment[], options?: IMessageOptions): Promise<void>;
	waitForNext(shouldAccept: (message: IMessage) => boolean, timeout: number | null): Promise<IMessage>;
}

export abstract class Conversation implements IConversation {
	readonly api: Api
	constructor(
		api: Api,
		public readonly conversationType: ConversationType,
	) {
		this.api = api;
	}

	readonly locale: Translation = new Translation();

	attributeStorage: AttributeStorage<this> = ownerlessEmptyAttributeStorage;

	async send(text: Text, attachments: Attachment[] = [], options: IMessageOptions = {}) {
		if (!options.locale) {
			options.locale = this.locale;
		}
		return await this.api.send(this, text, attachments, options);
	}

	// TODO: Move to message context somehow?
	async waitForNext(_shouldAccept: (message: IMessage) => boolean, _timeout: number | null): Promise<IMessage> {
		throw new Error('Method is not overridden by ayzek core');
	}

	get isUser() {
		return this.conversationType === ConversationType.USER;
	}
	get isChat() {
		return this.conversationType === ConversationType.CHAT;
	}

	abstract get reference(): TextPart;
}


export enum Gender {
	MAN,
	WOMAN,
	OTHER,
	UNSPECIFIED,
	ANDROGYNOUS,
	BOT,
}

export enum UserType {
	NORMAL,
	BOT,
}

export abstract class User<I = unknown> extends Conversation {
	constructor(
		api: Api,
		public readonly uid: string,
		public nickName: string | null,
		public firstName: string | null,
		public lastName: string | null,
		public gender: Gender,
		public profileUrl: string,
		public readonly isBot: boolean,
	) {
		super(api, ConversationType.USER);
	}

	/**
	 * API specific user representation
	 */
	abstract apiUser: I;

	abstract get photoImage(): Promise<Image | null>;

	private get idName() {
		return `<Unknown ${this.uid}>`;
	}

	get name(): string {
		if (this.nickName)
			return this.nickName;
		else if (this.firstName)
			return this.firstName;
		else return this.idName;
	}

	get fullName(): string {
		if (this.nickName && !this.firstName && !this.lastName)
			return this.nickName;
		let name = '';
		if (this.firstName)
			name += this.firstName + ' ';
		if (this.lastName)
			name += this.lastName + ' ';
		if (this.nickName)
			name += `(${this.nickName}) `;
		name = name.trim();
		if (name === '') {
			return this.idName;
		}
		return name;
	}

	get reference(): TextPart {
		return ayzekToOpaque({
			ayzekPart: 'user',
			user: this,
		});
	}
}

export abstract class Guild {
	constructor(
		public readonly api: Api,
		public readonly gid: string,
	) { }
}

export abstract class Chat<I = unknown> extends Conversation {
	constructor(
		api: Api,
		public readonly cid: string,
		public readonly users: User[],
		public readonly title: string,
		public readonly admins: User[],
		public readonly guild: Guild | null,
	) {
		super(api, ConversationType.CHAT);
	}

	/**
	* API specific chat representation
	*/
	abstract apiChat: I;

	abstract get photoImage(): Promise<Image | null>;

	get reference(): TextPart {
		return ayzekToOpaque({
			ayzekPart: 'chat',
			chat: this,
		});
	}
}
