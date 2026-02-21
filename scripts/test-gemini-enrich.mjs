#!/usr/bin/env node

/**
 * Standalone test for the Gemini enrichment pipeline.
 * Tests repairJSON, prompt building, single-call, and batch-call paths.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/test-gemini-enrich.mjs
 *   # Or with .env.local:
 *   node -e "require('dotenv').config({path:'.env.local'})" && node scripts/test-gemini-enrich.mjs
 */

// ─── Load .env.local if available ─────────────────────────────────
import { readFileSync, existsSync } from 'fs';
const envPath = new URL('../.env.local', import.meta.url).pathname;
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('❌ Missing GEMINI_API_KEY'); process.exit(1); }

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════
// repairJSON — the function we need to validate
// ═══════════════════════════════════════════════════════════════════

function repairJSON(raw) {
  let s = raw;
  s = s.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* continue */ } }

  let fixed = '';
  let inString = false;
  let escaped = false;
  const src = m ? m[0] : s;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escaped) { fixed += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { fixed += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; fixed += ch; continue; }
    if (inString) {
      if (ch === '\n') { fixed += '\\n'; continue; }
      if (ch === '\r') { fixed += '\\r'; continue; }
      if (ch === '\t') { fixed += '\\t'; continue; }
      if (ch.charCodeAt(0) < 32) continue;
    }
    fixed += ch;
  }
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) { /* continue */ }

  let nuclear = src.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  nuclear = nuclear.replace(/"([^"]*?)"/g, (match) => {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  });
  nuclear = nuclear.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(nuclear); } catch (_) { /* continue */ }

  throw new Error('JSON repair failed');
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: repairJSON with various malformed inputs
// ═══════════════════════════════════════════════════════════════════

function testRepairJSON() {
  console.log('\n═══ TEST 1: repairJSON ═══\n');
  let passed = 0;
  let failed = 0;

  const cases = [
    { name: 'clean JSON', input: '[{"a":"b"}]', expect: true },
    { name: 'markdown fences', input: '```json\n[{"a":"b"}]\n```', expect: true },
    { name: 'trailing comma', input: '[{"a":"b",}]', expect: true },
    { name: 'unescaped newline in string', input: '[{"a":"line1\nline2"}]', expect: true },
    { name: 'unescaped tab in string', input: '[{"a":"col1\tcol2"}]', expect: true },
    { name: 'mixed control chars', input: '[{"a":"hello\r\nworld\ttab"}]', expect: true },
    { name: 'nested unescaped newlines', input: '[{"long_description":"First line.\nSecond line.\nThird line.","tags":["a","b"]}]', expect: true },
    { name: 'preamble text + array', input: 'Here is the JSON:\n[{"a":"b"}]', expect: true },
    { name: 'completely invalid', input: 'not json at all {{{', expect: false },
    {
      name: 'realistic Gemini output with newlines in descriptions',
      input: `[\n  {\n    "artifact_type": "mcp-server",\n    "long_description": "A Model Context Protocol server that provides\nintegration with Slack.\nIt supports reading messages and channels.",\n    "category": "Automation",\n    "tags": ["slack", "mcp", "messaging"],\n    "compatible_platforms": ["Claude Code", "Cursor"],\n    "install_command": "npx -y @example/mcp-slack",\n    "npm_package_name": "@example/mcp-slack",\n    "meta_title": "MCP Slack Server",\n    "meta_description": "MCP server for Slack integration"\n  }\n]`,
      expect: true,
    },
  ];

  for (const tc of cases) {
    try {
      const result = repairJSON(tc.input);
      if (tc.expect) {
        console.log(`  ✅ ${tc.name}: parsed OK → ${JSON.stringify(result).substring(0, 80)}`);
        passed++;
      } else {
        console.log(`  ❌ ${tc.name}: should have thrown but got ${JSON.stringify(result).substring(0, 80)}`);
        failed++;
      }
    } catch (err) {
      if (!tc.expect) {
        console.log(`  ✅ ${tc.name}: correctly threw → ${err.message}`);
        passed++;
      } else {
        console.log(`  ❌ ${tc.name}: threw unexpectedly → ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

// ═══════════════════════════════════════════════════════════════════
// Test 2: Live Gemini single-repo enrichment
// ═══════════════════════════════════════════════════════════════════

const CATEGORY_LABELS = [
  'Frontend', 'Backend', 'DevOps', 'AI / ML', 'Database', 'Security',
  'Automation', 'Web Scraping', 'Research', 'Design', 'Mobile', 'Testing',
  'Data Engineering', 'Documentation', 'Productivity',
];

const PLATFORM_LABELS = [
  'Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode',
  'Kiro CLI', 'Continue', 'GitHub Copilot', 'Aider', 'Codex CLI', 'Amp',
  'n8n', 'LangChain', 'CrewAI',
];

const VALID_TYPES = ['skill', 'mcp-server', 'cursor-rules', 'n8n-node', 'workflow', 'langchain-tool', 'crewai-tool'];

function buildGeminiPrompt(items) {
  const repoSummaries = items.map((item, idx) => {
    const excerpt = item.readme ? item.readme.substring(0, 1800) : 'No README.';
    return `### REPO_${idx}
- full_name: ${item.full_name}
- description: ${item.description || '(none)'}
- language: ${item.language || 'Unknown'}
- stars: ${item.stars} | forks: ${item.forks}
- topics: ${item.topics_str || '(none)'}
- updated: ${item.github_updated_at}
README excerpt:
${excerpt}`;
  }).join('\n\n');

  return `You are classifying ${items.length} GitHub repositories as "agent artifacts" for OneSkill.dev. Return ONLY a valid JSON array of ${items.length} objects — one per repo, same order. No markdown fences, no extra text.

${repoSummaries}

## Classification rules
artifact_type must be EXACTLY one of: skill, mcp-server, cursor-rules, n8n-node, workflow, langchain-tool, crewai-tool
category must be EXACTLY one of: ${CATEGORY_LABELS.join(', ')}
compatible_platforms must be a subset of: ${PLATFORM_LABELS.join(', ')}
tags: 3–7 lowercase hyphenated keywords (e.g. "web-scraping", "auth", "react")

Each object shape:
{"artifact_type":"...","long_description":"2-3 sentences.","category":"...","tags":[...],"compatible_platforms":[...],"install_command":"...","npm_package_name":null,"meta_title":"under 60 chars","meta_description":"under 160 chars"}`;
}

// Mock repos for testing
const MOCK_REPOS = [
  {
    full_name: 'anthropics/mcp-server-slack',
    description: 'MCP server for Slack integration — read/search messages, list channels',
    language: 'TypeScript',
    stars: 450,
    forks: 89,
    topics_str: 'mcp-server, slack, model-context-protocol',
    github_updated_at: '2025-12-01T00:00:00Z',
    readme: '# MCP Slack Server\n\nA Model Context Protocol server for Slack.\n\n## Install\n```\nnpx -y @anthropics/mcp-server-slack\n```\n\n## Features\n- Read messages from channels\n- Search message history\n- List channels and users',
    type_hint: 'mcp-server',
  },
  {
    full_name: 'example/cursor-rules-react',
    description: 'Cursor rules for React + TypeScript projects with best practices',
    language: 'Markdown',
    stars: 120,
    forks: 25,
    topics_str: 'cursor-rules, react, typescript',
    github_updated_at: '2025-11-15T00:00:00Z',
    readme: '# React Cursor Rules\n\nCursor rules for modern React + TypeScript.\n\n## Usage\nAdd the .cursorrules file to your project root.',
    type_hint: 'cursor-rules',
  },
  {
    full_name: 'example/n8n-nodes-notion',
    description: 'Custom n8n community node for Notion integration',
    language: 'TypeScript',
    stars: 80,
    forks: 12,
    topics_str: 'n8n-community-node-package, notion',
    github_updated_at: '2025-10-20T00:00:00Z',
    readme: '# n8n Notion Node\n\nCommunity node for n8n that integrates with Notion API.\n\n## Install\n```\nnpm install n8n-nodes-notion\n```',
    type_hint: 'n8n-node',
  },
];

async function testSingleEnrichment() {
  console.log('\n═══ TEST 2: Live Gemini single-repo enrichment ═══\n');

  const item = MOCK_REPOS[0];
  const prompt = buildGeminiPrompt([item]);

  console.log(`  Prompt length: ${prompt.length} chars`);
  console.log(`  Sending to ${GEMINI_MODEL}...`);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 600, responseMimeType: 'application/json' },
      }),
    });

    console.log(`  HTTP status: ${res.status}`);
    if (!res.ok) {
      const text = await res.text();
      console.log(`  ❌ Error: ${text.substring(0, 300)}`);
      return false;
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`  Raw response (${raw.length} chars): ${raw.substring(0, 200)}...`);

    const parsed = repairJSON(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const result = arr[0];

    console.log(`\n  Parsed result:`);
    console.log(`    artifact_type:  ${result.artifact_type} ${VALID_TYPES.includes(result.artifact_type) ? '✅' : '❌'}`);
    console.log(`    category:       ${result.category} ${CATEGORY_LABELS.includes(result.category) ? '✅' : '❌'}`);
    console.log(`    tags:           ${JSON.stringify(result.tags)}`);
    console.log(`    platforms:      ${JSON.stringify(result.compatible_platforms)}`);
    console.log(`    install_cmd:    ${result.install_command}`);
    console.log(`    long_desc:      ${(result.long_description || '').substring(0, 100)}`);
    console.log(`    meta_title:     ${result.meta_title}`);

    return true;
  } catch (err) {
    console.log(`  ❌ Exception: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: Live Gemini batch enrichment (3 repos in 1 call)
// ═══════════════════════════════════════════════════════════════════

async function testBatchEnrichment() {
  console.log('\n═══ TEST 3: Live Gemini batch enrichment (3 repos) ═══\n');

  const prompt = buildGeminiPrompt(MOCK_REPOS);
  console.log(`  Prompt length: ${prompt.length} chars`);
  console.log(`  Sending ${MOCK_REPOS.length} repos to ${GEMINI_MODEL}...`);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: MOCK_REPOS.length * 400, responseMimeType: 'application/json' },
      }),
    });

    console.log(`  HTTP status: ${res.status}`);
    if (!res.ok) {
      const text = await res.text();
      console.log(`  ❌ Error: ${text.substring(0, 300)}`);
      return false;
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`  Raw response (${raw.length} chars): ${raw.substring(0, 300)}...`);

    const parsed = repairJSON(raw);

    if (!Array.isArray(parsed)) {
      console.log(`  ❌ Expected array, got ${typeof parsed}`);
      return false;
    }

    console.log(`  ✅ Parsed array with ${parsed.length} items (expected ${MOCK_REPOS.length})`);

    let allValid = true;
    for (let i = 0; i < parsed.length; i++) {
      const result = parsed[i];
      const repo = MOCK_REPOS[i];
      const typeOk = VALID_TYPES.includes(result?.artifact_type);
      const catOk = CATEGORY_LABELS.includes(result?.category);
      const tagsOk = Array.isArray(result?.tags) && result.tags.length > 0;

      console.log(`\n  [${i}] ${repo.full_name}:`);
      console.log(`    type:     ${result?.artifact_type} ${typeOk ? '✅' : '❌'}`);
      console.log(`    category: ${result?.category} ${catOk ? '✅' : '❌'}`);
      console.log(`    tags:     ${JSON.stringify(result?.tags)} ${tagsOk ? '✅' : '❌'}`);
      console.log(`    install:  ${result?.install_command}`);

      if (!typeOk || !catOk || !tagsOk) allValid = false;
    }

    return allValid;
  } catch (err) {
    console.log(`  ❌ Exception: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: Stress test — deliberately bad JSON from Gemini-like output
// ═══════════════════════════════════════════════════════════════════

function testEdgeCaseJSON() {
  console.log('\n═══ TEST 4: Edge case JSON repair ═══\n');
  let passed = 0;
  let failed = 0;

  const cases = [
    {
      name: 'Gemini wraps in markdown code block with language tag',
      input: '```json\n[{"artifact_type":"skill","long_description":"A tool.","category":"Backend","tags":["api"],"compatible_platforms":["Claude Code"],"install_command":"npx skills add foo/bar","npm_package_name":null,"meta_title":"Foo","meta_description":"Bar"}]\n```',
    },
    {
      name: 'Newlines in long_description and meta_description',
      input: `[{"artifact_type":"mcp-server","long_description":"This is a server.\nIt does things.\nMany things.","category":"Automation","tags":["test"],"compatible_platforms":["Cursor"],"install_command":"npx -y test","npm_package_name":null,"meta_title":"Test\nServer","meta_description":"A description\nwith breaks"}]`,
    },
    {
      name: 'Tab characters in values',
      input: `[{"artifact_type":"skill","long_description":"Col1\tCol2\tCol3","category":"Backend","tags":["a"],"compatible_platforms":[],"install_command":"test","npm_package_name":null,"meta_title":"Test","meta_description":"Desc"}]`,
    },
    {
      name: 'Trailing commas everywhere',
      input: `[{"artifact_type":"skill","long_description":"Test.","category":"Frontend","tags":["a","b",],"compatible_platforms":["Cursor",],"install_command":"test","npm_package_name":null,"meta_title":"Test","meta_description":"Desc",},]`,
    },
    {
      name: 'Preamble text before JSON array',
      input: `Here is the classification:\n\n[{"artifact_type":"n8n-node","long_description":"Node.","category":"Automation","tags":["n8n"],"compatible_platforms":["n8n"],"install_command":"npm install test","npm_package_name":"test","meta_title":"Test","meta_description":"Desc"}]`,
    },
  ];

  for (const tc of cases) {
    try {
      const result = repairJSON(tc.input);
      if (Array.isArray(result) && result.length > 0 && result[0].artifact_type) {
        console.log(`  ✅ ${tc.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${tc.name}: parsed but invalid structure → ${JSON.stringify(result).substring(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${tc.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

// ═══════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('🧪 Gemini Enrichment Test Suite\n');

  const results = [];

  // Test 1: repairJSON
  results.push({ name: 'repairJSON', pass: testRepairJSON() });

  // Test 4: Edge case JSON repair
  results.push({ name: 'Edge case JSON', pass: testEdgeCaseJSON() });

  // Test 2: Single enrichment (live API)
  results.push({ name: 'Single enrichment', pass: await testSingleEnrichment() });
  await sleep(1500);

  // Test 3: Batch enrichment (live API)
  results.push({ name: 'Batch enrichment', pass: await testBatchEnrichment() });

  // Summary
  console.log('\n═══ SUMMARY ═══\n');
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`);
  }

  const allPassed = results.every(r => r.pass);
  console.log(`\n${allPassed ? '🎉 All tests passed!' : '⚠️  Some tests failed.'}\n`);
  process.exit(allPassed ? 0 : 1);
}

main();
