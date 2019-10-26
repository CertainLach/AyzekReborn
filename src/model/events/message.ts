import { IMessage } from "../message";
import { Attachment } from "../attachment/attachment";
import { User, Chat, Conversation } from "../conversation";
import { Api } from "../api";

export class MessageEvent<A extends Api> implements IMessage<A> {
	constructor(
		public api: A,
		public user: User<A>,
		public chat: Chat<A> | null,
		public conversation: Conversation<A>,
		public attachments: Attachment[],
		public text: string,
		/**
		 * Forwarded messages, sorted ascending by time
		 */
		public forwarded: IMessage<A>[],
		/**
		 * Messenger specific message id
		 */
		public messageId: string,
		public replyTo: IMessage<A> | null
	) { }

	/**
	 * Return reply if available, and last forwarded otherwise
	 */
	get maybeForwarded(): IMessage<A> | null {
		if (this.replyTo) return this.replyTo;
		if (this.forwarded.length >= 1) return this.forwarded[this.forwarded.length - 1];
		return null;
	}
}
