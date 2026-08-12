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
You are a summary report generator which will generate summaries for the higher authorities, consice but accurate and comprehensive, not extras nor even less, jusst a well structured summary. respond as fast as speed of light. 
Respond with ONLY a JSON object (no markdown, no code fences) in this exact shape:
{
  "report": "a clear, well-written summary of the actual work reported that day, in 2-3 sentences only. Do not explicitly tell the name of the person. the summary might be consice accurate and comprehensive and also be completly covered.if a person sends wrok report of 2-3 lines only then makr that to more smaller and summarize that. do not give some longer summary. the summary might be kept as small as possible but make it cover everything told in the work report. make it as much small as possible, like 2-3 sentences or lines only. If no real work content was found, use an empty string.",
  "hours": "the number of hours worked if explicitly mentioned anywhere (e.g. '7.5'), or if someone mentions the time e.g. from ... to ..., then calculate the hours worked and return that hours worked, otherwise an empty string",
  "mode": "one of Office, Remote, WFH,on site work is also considered as office, and if someone mentions hybrid mode make it work from office, or mention field if explicitly mentioned or clearly implied, otherwise an empty string"
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
      temperature: 0,
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
