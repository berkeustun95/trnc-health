const { execFileSync } = require('child_process');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', 'node_modules', 'expo', 'template.tgz');
const template = execFileSync(
  'tar',
  ['-xzOf', TEMPLATE, 'package/android/app/src/main/java/com/helloworld/MainActivity.kt'],
  { encoding: 'utf8' }
);

const { applyHeldNewIntent } = require('../plugins/withHeldNewIntent');

const count = (s, needle) => s.split(needle).length - 1;

describe('withHeldNewIntent transform', () => {
  const out = applyHeldNewIntent(template);

  test('adds the Intent import once', () => {
    expect(count(out, 'import android.content.Intent')).toBe(1);
  });

  test('adds fields, onNewIntent and loadApp overrides', () => {
    expect(out).toContain('private var adaAppLoaded = false');
    expect(out).toContain('private var adaHeldIntent: Intent? = null');
    expect(out).toContain('override fun onNewIntent(intent: Intent)');
    expect(out).toContain('override fun loadApp(appKey: String?)');
    expect(out).toContain('adaDeliverHeldIntent()');
  });

  test('calls super.onNewIntent exactly twice', () => {
    expect(count(out, 'super.onNewIntent(')).toBe(2);
  });

  test('braces balance', () => {
    expect(count(out, '{')).toBe(count(out, '}'));
    expect(count(out, '(')).toBe(count(out, ')'));
  });

  test('is idempotent', () => {
    expect(applyHeldNewIntent(out)).toBe(out);
  });

  test('throws without the delegate anchor', () => {
    const broken = template.replace('DefaultReactActivityDelegate(', 'OtherDelegate(');
    expect(() => applyHeldNewIntent(broken)).toThrow(/DefaultReactActivityDelegate/);
  });

  test('throws without the class anchor', () => {
    expect(() => applyHeldNewIntent(template.replace('class MainActivity', 'class Other'))).toThrow(/class MainActivity/);
  });

  test('throws when onNewIntent is already overridden', () => {
    const other = template.replace(
      'class MainActivity : ReactActivity() {\n',
      'class MainActivity : ReactActivity() {\n  override fun onNewIntent(intent: android.content.Intent) {}\n'
    );
    expect(other).not.toBe(template);
    expect(() => applyHeldNewIntent(other)).toThrow(/onNewIntent/);
  });

  test('throws when loadApp is already overridden', () => {
    const other = template.replace('){})', '){ override fun loadApp(appKey: String?) {} })');
    expect(other).not.toBe(template);
    expect(() => applyHeldNewIntent(other)).toThrow(/loadApp/);
  });
});
