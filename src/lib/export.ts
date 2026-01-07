import type { Message, Conversation } from '../types';

/**
 * Export conversation as Markdown
 */
export function exportAsMarkdown(conversation: Conversation, messages: Message[]): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${conversation.title}`);
  lines.push('');
  lines.push(`*Exported on ${new Date().toLocaleDateString()}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const message of messages) {
    const role = message.role === 'user' ? '**You**' : '**Assistant**';
    const timestamp = new Date(message.createdAt).toLocaleString();
    
    lines.push(`### ${role}`);
    lines.push(`*${timestamp}*`);
    
    if (message.providerId) {
      lines.push(`*via ${message.providerId}${message.model ? ` (${message.model})` : ''}*`);
    }
    
    lines.push('');
    lines.push(message.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export conversation as JSON
 */
export function exportAsJson(
  conversation: Conversation,
  messages: Message[],
  options: { includeMetadata?: boolean } = {}
): string {
  const { includeMetadata = true } = options;

  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: new Date(conversation.createdAt).toISOString(),
      updatedAt: new Date(conversation.updatedAt).toISOString(),
      messageCount: conversation.messageCount,
    },
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt).toISOString(),
      ...(includeMetadata && m.providerId && {
        providerId: m.providerId,
        model: m.model,
        tokens: m.tokens,
        latencyMs: m.latencyMs,
      }),
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Download content as a file
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Export conversation and trigger download
 */
export function exportConversation(
  conversation: Conversation,
  messages: Message[],
  format: 'markdown' | 'json'
): void {
  const sanitizedTitle = conversation.title
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .slice(0, 50);

  if (format === 'markdown') {
    const content = exportAsMarkdown(conversation, messages);
    downloadFile(content, `${sanitizedTitle}.md`, 'text/markdown');
  } else {
    const content = exportAsJson(conversation, messages);
    downloadFile(content, `${sanitizedTitle}.json`, 'application/json');
  }
}

