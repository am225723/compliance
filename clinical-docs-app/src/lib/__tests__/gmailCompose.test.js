import { describe, it, expect } from 'vitest';
import { buildGmailComposeUrl } from '../gmailCompose';

describe('buildGmailComposeUrl', () => {
  it('builds a Gmail web-compose URL with subject and body', () => {
    const url = buildGmailComposeUrl({ subject: 'Hello', body: 'World' });
    expect(url).toContain('https://mail.google.com/mail/?');
    expect(url).toContain('view=cm');
    expect(url).toContain('fs=1');
    expect(url).toContain('su=Hello');
    expect(url).toContain('body=World');
  });

  it('URL-encodes special characters in subject/body', () => {
    const url = buildGmailComposeUrl({ subject: 'A & B', body: 'Line1\nLine2' });
    expect(url).not.toContain('A & B');
    expect(url).not.toContain('\n');
  });

  it('omits the "to" param when no recipient is given', () => {
    const url = buildGmailComposeUrl({ subject: 'x', body: 'y' });
    expect(url).not.toContain('to=');
  });

  it('includes the "to" param when a recipient is given', () => {
    const url = buildGmailComposeUrl({ to: 'patient@example.com', subject: 'x', body: 'y' });
    expect(url).toContain('to=patient%40example.com');
  });
});
