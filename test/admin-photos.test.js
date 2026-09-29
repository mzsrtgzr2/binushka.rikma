const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function element() {
  return {
    hidden: true,
    textContent: '',
    className: '',
    value: '',
    files: [],
    disabled: false,
    readOnly: false,
    checked: false,
    innerHTML: '',
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    appendChild() {},
    focus() {},
    submit() {},
  };
}

function loadAdmin(readMode) {
  const elements = {};
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = element();
      return elements[id];
    },
    createElement() {
      return { textContent: '', innerHTML: '' };
    },
    body: element(),
  };
  const photoFiles = document.getElementById('admin-photo-files');
  const seen = [];

  function FileReader() {
    this.result = '';
    this.onload = null;
    this.onerror = null;
  }
  FileReader.prototype.readAsDataURL = function () {
    seen.push(photoFiles.value);
    const self = this;
    if (readMode === 'throw') {
      const err = new Error('The I/O read operation failed');
      err.name = 'NotReadableError';
      throw err;
    }
    queueMicrotask(function () {
      if (readMode === 'error') {
        self.onerror({ preventDefault() {}, stopPropagation() {} });
        return;
      }
      self.result = 'data:image/png;base64,abc';
      self.onload();
    });
  };

  const context = {
    document,
    window: {
      location: { pathname: '/admin/', search: '' },
      scrollTo() {},
    },
    fetch() {
      return new Promise(function () {});
    },
    FileReader,
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8'), context);
  return { photoFiles, photosMessage: elements['admin-photos-message'], seen };
}

function pngFile() {
  return { name: 'hoop.png', type: 'image/png', size: 1200 };
}

test('product photo reads the file before the picker is cleared', async () => {
  const admin = loadAdmin('ok');
  admin.photoFiles.value = 'still-selected';
  admin.photoFiles.files = [pngFile()];
  admin.photoFiles.listeners.change();
  assert.deepEqual(admin.seen, ['still-selected']);
  await new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
  assert.equal(admin.photoFiles.value, '');
  assert.match(admin.photosMessage.textContent, /התמונה נוספה/);
});

test('an unreadable product photo stays a handled message', async () => {
  const admin = loadAdmin('throw');
  admin.photoFiles.value = 'still-selected';
  admin.photoFiles.files = [pngFile()];
  admin.photoFiles.listeners.change();
  assert.deepEqual(admin.seen, ['still-selected']);
  await new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
  assert.equal(admin.photoFiles.value, '');
  assert.equal(admin.photosMessage.textContent, 'לא הצלחנו לקרוא את הקובץ');
});

test('a FileReader error event does not surface the browser I/O message', async () => {
  const admin = loadAdmin('error');
  admin.photoFiles.value = 'still-selected';
  admin.photoFiles.files = [pngFile()];
  admin.photoFiles.listeners.change();
  await new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
  assert.equal(admin.photoFiles.value, '');
  assert.equal(admin.photosMessage.textContent, 'לא הצלחנו לקרוא את הקובץ');
});
