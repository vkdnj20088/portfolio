import { ChatRoom } from '@/components/room/ChatRoom';

/** 채팅방 (/c/[chatId]). Next 15 부터 params 는 Promise 다. */
export default async function ChatRoomPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return <ChatRoom chatId={chatId} />;
}
