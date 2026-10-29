import { errorText } from './errors';

describe('errorText', () => {
  it('uses the server message', () => {
    expect(errorText({ status: 400, error: { detail: 'Wrong code' } })).toBe('Wrong code');
  });

  it('turns a validation list into plain words', () => {
    expect(errorText({ status: 422, error: { detail: [{ msg: 'Value error, You must be 18 or older to apply' }] } }))
      .toBe('You must be 18 or older to apply');
  });

  for (const status of [0, 502, 503, 504]) {
    it(`explains an unreachable server (${status})`, () => {
      expect(errorText({ status })).toContain('Can’t reach the MyTerra server');
    });
  }

  it('falls back when there is nothing useful', () => {
    expect(errorText({ status: 500 }, 'Try later')).toBe('Try later');
  });
});
