export function buildCanonQuery(chat, depth = 3) {
    return (Array.isArray(chat) ? chat : []).filter(message => !message.is_system && message.mes)
        .slice(-depth).map(message => String(message.mes)).join('\n').slice(-6000);
}
