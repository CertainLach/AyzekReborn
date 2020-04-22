import { AttributeStorage, ownerlessEmptyAttributeStorage } from "@ayzek/attribute";
import type { Api } from "./api";
import type { Attachment, Image } from "./attachment";
import type { IMessage, IMessageOptions } from "./message";
import type { Text, TextPart } from '@ayzek/text';

enum ConversationType {
	USER,
	CHAT,
	OTHER
}

export interface IConversation<A extends Api<A>> {
	// TODO: Edit message?
	send(text: Text, attachments?: Attachment[], options?: IMessageOptions): Promise<void>;
	waitForNext(shouldAccept: (message: IMessage<A>) => boolean, timeout: number | null): Promise<IMessage<A>>;
}

export abstract class Conversation<A extends Api<A>> implements IConversation<A> {
	readonly api: A
	constructor(
		api: A,
		public readonly targetId: string,
		public readonly conversationType: ConversationType,
	) {
		this.api = api;
	}

	attachmentStorage: AttributeStorage<this> = ownerlessEmptyAttributeStorage;

	async send(text: Text<A>, attachments: Attachment[] = [], options: IMessageOptions = {}) {
		return await this.api.send(this, text, attachments, options);
	}

	// TODO: Move to message context somehow?
	async waitForNext(shouldAccept: (message: IMessage<A>) => boolean, timeout: number | null): Promise<IMessage<A>> {
		throw new Error('Method is not overriden by ayzek core');
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
};

export enum UserType {
	NORMAL,
	BOT,
}

export abstract class User<A extends Api<A>> extends Conversation<A> {
	constructor(
		api: A,
		targetId: string,
		public readonly uid: string,
		public readonly nickName: string | null,
		public readonly firstName: string | null,
		public readonly lastName: string | null,
		public readonly gender: Gender,
		public readonly profileUrl: string,
		public readonly isBot: boolean,
	) {
		super(api, targetId, ConversationType.USER);
	}

	/**
	 * API specific user representation
	 */
	abstract apiUser: any;

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
		return {
			type: 'mentionPart',
			data: this,
		} as MentionTextPart<A>
	}
}

export abstract class Guild<A extends Api<A>> {
	constructor(
		public readonly api: A,
		public readonly gid: string,
	) { };
};

export abstract class Chat<A extends Api<A>> extends Conversation<A> {
	constructor(
		api: A,
		targetId: string,
		public readonly cid: string,
		public readonly users: User<A>[],
		public readonly title: string,
		public readonly admins: User<A>[],
		public readonly guild: Guild<A> | null,
	) {
		super(api, targetId, ConversationType.CHAT);
	}

	/**
	* API specific chat representation
	*/
	abstract apiChat: any;

	abstract get photoImage(): Promise<Image | null>;

	get reference(): TextPart<A> {
		return {
			type: 'chatRefPart',
			data: this,
		} as ChatReferenceTextPart<A>
	}
}