const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Turns a day's raw WhatsApp messages from one person's report group into a
 * clean work-report summary, ignoring off-topic chatter, using Llama on Groq.
 *
 * messages: [{ sender_name, body, msg_ts }]
 * Returns: { report, hours, mode, messageCount }
 */
async function summarizeDayMessages(memberName, dateStr, messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set on the server (see .env.example)');
  }
  if (!messages.length) {
    return { report: '', hours: '', mode: '', messageCount: 0 };
  }

  const transcript = messages
    .map(m => {
      const time = new Date(m.msg_ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${m.sender_name || 'them'}: ${m.body}`;
    })
    .join('\n');

  const prompt = `You are helping turn a WhatsApp group chat into a clean daily work report.
The group belongs to one team member, ${memberName}, and is meant for posting daily work updates.
Below is every message sent in that group on ${dateStr}, in order.

Some messages are genuine work updates (tasks worked on, progress, blockers, meetings, hours worked, work mode like Office/Remote/WFH/Field).
Other messages may be irrelevant small talk, greetings, stickers/emoji-only reactions, or off-topic chat — ignore those completely.

Messages:
"""
${transcript}
"""

Respond with ONLY a JSON object (no markdown, no code fences) in this exact shape:
{
  "report": "a clear, well-written first-person summary of the actual work reported that day, in 2-6 sentences or short bullet points separated by newlines. If no real work content was found, use an empty string.",
  "hours": "the number of hours worked if explicitly mentioned anywhere (e.g. '7.5'), otherwise an empty string",
  "mode": "one of Office, Remote, WFH, Field if explicitly mentioned or clearly implied, otherwise an empty string"
}`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Groq request failed (${res.status})`);
  }

  const raw = json?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = { report: raw.trim(), hours: '', mode: '' };
  }

  return {
    report: (parsed.report || '').toString().trim(),
    hours: (parsed.hours || '').toString().trim(),
    mode: (parsed.mode || '').toString().trim(),
    messageCount: messages.length
  };
}

module.exports = { summarizeDayMessages };
