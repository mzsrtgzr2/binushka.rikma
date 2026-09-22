/**
 * Copy for the mails we send.
 *
 * Unlike the on-site strings in _data/settings.yml this is not read by Jekyll,
 * only by the serverless sender, so it lives next to the code that uses it.
 *
 * `sender_line` is not decoration: Israeli spam law wants the advertiser
 * identifiable in the message itself, alongside a way to be removed.
 */

export const emailCopy = {
  brand: 'בינושקה · אומנות הרקמה',
  from_name: 'בינושקה',
  // Prefixed onto the subject of commercial issues. Israeli law (סעיף 30א)
  // wants advertising marked as such.
  subject_prefix: 'פרסומת:',
  sender_line: 'בינושקה · אומנות הרקמה · rikma.binushka.com',
  read_online: 'לקריאת הגיליון באתר',
  unsubscribe_text: 'להסרה מרשימת התפוצה',
  welcome: {
    title: 'נרשמת לניוזלטר של בינושקה',
    body: [
      'תודה שנרשמת! מעכשיו תקבלי ממני עדכונים על סדנאות חדשות, ערכות רקמה ופרויקטים מיוחדים.',
      '',
      'אם לא את נרשמת, אפשר להסיר את הכתובת בלחיצה אחת בקישור שבתחתית המייל הזה.',
    ].join('\n'),
  },
};

export default emailCopy;
