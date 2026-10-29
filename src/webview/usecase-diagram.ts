function escapeFlowchartLabel(label: string): string {
  return label
    .replace(/&/g, '#amp;')
    .replace(/"/g, '#quot;')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/\r?\n/g, ' ');
}

export function translateUsecaseDiagram(source: string): string | undefined {
  const lines = source.split(/\r?\n/);
  const firstContentLine = lines.findIndex((line) => line.trim() !== '');
  if (firstContentLine < 0 || lines[firstContentLine].trim().toLowerCase() !== 'usecase-beta') {
    return undefined;
  }

  const actors = new Map<string, string>();
  const useCases = new Map<string, string>();
  const associations: Array<[string, string]> = [];

  for (const [index, rawLine] of lines.entries()) {
    if (index === firstContentLine || rawLine.trim() === '') {
      continue;
    }

    const line = rawLine.trim();
    const actorMatch = /^actor\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s*\(\s*"([^"]*)"\s*\))?$/.exec(line);
    if (actorMatch) {
      if (actors.has(actorMatch[1]) || useCases.has(actorMatch[1])) {
        throw new Error(`Duplicate use-case diagram identifier: ${actorMatch[1]}`);
      }
      actors.set(actorMatch[1], actorMatch[2] || actorMatch[1]);
      continue;
    }

    const useCaseMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*\(\s*"([^"]+)"\s*\)$/.exec(line);
    if (useCaseMatch) {
      if (actors.has(useCaseMatch[1]) || useCases.has(useCaseMatch[1])) {
        throw new Error(`Duplicate use-case diagram identifier: ${useCaseMatch[1]}`);
      }
      useCases.set(useCaseMatch[1], useCaseMatch[2]);
      continue;
    }

    const associationMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*-->\s*([A-Za-z_][A-Za-z0-9_-]*)$/.exec(line);
    if (associationMatch) {
      associations.push([associationMatch[1], associationMatch[2]]);
      continue;
    }

    throw new Error(`Unsupported use-case diagram syntax: ${line}`);
  }

  if (actors.size === 0 || useCases.size === 0) {
    throw new Error('A use-case diagram must define at least one actor and one use case.');
  }

  for (const [from, to] of associations) {
    if ((!actors.has(from) && !useCases.has(from)) ||
      (!actors.has(to) && !useCases.has(to))) {
      throw new Error(`Use-case association refers to an unknown identifier: ${from} --> ${to}`);
    }
  }

  const translated = ['flowchart LR'];
  for (const [id, label] of actors) {
    translated.push(`  actor_${id}(["👤 ${escapeFlowchartLabel(label)}"])`);
  }
  for (const [id, label] of useCases) {
    translated.push(`  usecase_${id}(("${escapeFlowchartLabel(label)}"))`);
  }
  for (const [from, to] of associations) {
    const fromPrefix = actors.has(from) ? 'actor' : 'usecase';
    const toPrefix = actors.has(to) ? 'actor' : 'usecase';
    translated.push(`  ${fromPrefix}_${from} --> ${toPrefix}_${to}`);
  }
  translated.push('  classDef actor fill:transparent,stroke-width:0px');
  translated.push('  classDef usecase fill:transparent');
  translated.push(`  class ${[...actors.keys()].map((id) => `actor_${id}`).join(',')} actor`);
  translated.push(`  class ${[...useCases.keys()].map((id) => `usecase_${id}`).join(',')} usecase`);
  return translated.join('\n');
}
