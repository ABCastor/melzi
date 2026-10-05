/* Contextual guidance is deliberately data. Modes ask for one control at a
 * time, so the island never grows a competing tips panel. */
(function () {
  'use strict';

  var I = Island;
  var data = [
    { control: 'colour.contrast', when: function (context) { return Number(context && context.wcag) < 4.5; }, text: 'Body text needs at least 4.5:1 contrast.', source: 'WCAG 2.2 SC 1.4.3' },
    { control: 'colour.roles', when: function (context) { return !!(context && context.missingStateRoles); }, text: 'Name interactive and status roles, not only surfaces.', source: 'HN discussion: Happy Hues' },
    { control: 'colour.theme', when: function (context) { return !!(context && context.darkFirstMissing); }, text: 'Treat dark as a starting palette, not an inverted afterthought.', source: 'HN discussion: Refactoring UI' },
    { control: 'colour.gamut', when: function (context) { return !!(context && context.outOfGamut); }, text: 'Keep this colour inside the target gamut before judging it.', source: 'CSS Color 4 gamut guidance' },
    { control: 'type.reading', when: function (context) { return !!(context && context.readingFloorFailed); }, text: 'Body reading needs 16px, 1.4 line height, and roughly 60-80ch.', source: 'WCAG 2.2 and typography practice' },
    { control: 'type.licence', when: function (context) { return !!(context && context.personalUse); }, text: 'Personal-use faces can be previewed, never handed over.', source: 'Font licence terms' },
    { control: 'type.specimen', when: function (context) { return !!(context && context.genericSpecimen); }, text: 'Judge the words this page actually needs to say.', source: 'WordMark.it practice' },
    { control: 'compare.mixed', when: function (context) { return !!(context && context.mixedSet); }, text: 'Conventional options are included only because you asked for them.', source: 'Review Island §17.3' },
    { control: 'compare.memory', when: function (context) { return !!(context && context.verdictDrift); }, text: 'A changed judgement is useful evidence, not an error to hide.', source: 'Review Island §8 and §14.1' }
  ];

  function matches(entry, control) {
    return entry.control === control || entry.control === String(control || '').replace(/\.[^.]+$/, '');
  }
  function forControl(control, context) {
    for (var index = 0; index < data.length; index++) {
      var entry = data[index];
      if (matches(entry, control) && entry.when(context || {})) return { text: entry.text, source: entry.source, control: entry.control };
    }
    return null;
  }

  function append(container, control, context) {
    var entry = forControl(control, context);
    if (!entry || !container || !I.dom) return null;
    var line = I.dom.el('p', { 'class': 'island-advice', style: { margin: '0', color: 'var(--muted)', fontSize: '10px', lineHeight: '1.4' } });
    line.appendChild(I.dom.el('span', { text: entry.text + ' ' }));
    var why = I.dom.button('why', { style: { border: '0', padding: '0', background: 'transparent', color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: '2px' }, 'aria-expanded': 'false' });
    var source = I.dom.el('span', { text: ' ' + entry.source, hidden: true });
    why.addEventListener('click', function () { source.hidden = !source.hidden; why.setAttribute('aria-expanded', String(!source.hidden)); });
    line.appendChild(why); line.appendChild(source); container.appendChild(line); return line;
  }

  I.advice = { data: data, for: forControl, append: append };
})();
