import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');
const SCHEMA_DIR = join(ROOT, 'schemas/protocol');
const FIXTURE = join(ROOT, 'test-fixtures/protocol/canonical.json');

const schemaFixtureMap: Record<string, string> = {
  'envelope.schema.json': 'envelope',
  'route-record.schema.json': 'routeRecord',
  'send-ack.schema.json': 'sendAck',
  'delivery-receipt.schema.json': 'deliveryReceipt',
  'receipt-list-result.schema.json': 'receiptListResult',
  'sidecar-events-response.schema.json': 'sidecarEventsResponse',
  'sidecar-status.schema.json': 'sidecarStatus',
  'sidecar-send-request.schema.json': 'sidecarSendRequest',
  'sidecar-send-response.schema.json': 'sidecarSendResponse',
  'error-response.schema.json': 'errorResponse',
};

type Schema = Record<string, unknown>;

const schemas = new Map<string, Schema>();

function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function schema(name: string): Schema {
  const existing = schemas.get(name);
  if (existing) {
    return existing;
  }
  const loaded = loadJson(join(SCHEMA_DIR, name));
  schemas.set(name, loaded);
  if (typeof loaded.$id === 'string') {
    schemas.set(loaded.$id, loaded);
  }
  return loaded;
}

function validate(current: Schema, value: unknown, path = '$'): string[] {
  if (typeof current.$ref === 'string') {
    return validate(schema(basename(current.$ref)), value, path);
  }

  const oneOf = current.oneOf;
  if (Array.isArray(oneOf)) {
    const matches = oneOf.filter((item) => validate(item as Schema, value, path).length === 0);
    return matches.length === 1 ? [] : [`${path} must match exactly one schema`];
  }

  const anyOf = current.anyOf;
  if (Array.isArray(anyOf) && !anyOf.some((item) => validate(item as Schema, value, path).length === 0)) {
    return [`${path} must match at least one schema`];
  }

  const errors: string[] = [];
  const expectedType = current.type;
  if (expectedType !== undefined && !matchesType(value, expectedType)) {
    errors.push(`${path} expected ${JSON.stringify(expectedType)}`);
    return errors;
  }

  if ('const' in current && value !== current.const) {
    errors.push(`${path} expected const ${JSON.stringify(current.const)}`);
  }

  if (Array.isArray(current.enum) && !current.enum.includes(value)) {
    errors.push(`${path} expected enum ${JSON.stringify(current.enum)}`);
  }

  if (typeof value === 'string') {
    if (typeof current.pattern === 'string' && !new RegExp(current.pattern).test(value)) {
      errors.push(`${path} does not match ${current.pattern}`);
    }
    if (typeof current.minLength === 'number' && value.length < current.minLength) {
      errors.push(`${path} shorter than ${current.minLength}`);
    }
  }

  if (typeof value === 'number' && typeof current.minimum === 'number' && value < current.minimum) {
    errors.push(`${path} below minimum ${current.minimum}`);
  }

  if (Array.isArray(value)) {
    if (typeof current.minItems === 'number' && value.length < current.minItems) {
      errors.push(`${path} has too few items`);
    }
    if (current.items && typeof current.items === 'object') {
      value.forEach((item, index) => {
        errors.push(...validate(current.items as Schema, item, `${path}[${index}]`));
      });
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(current.required) ? current.required.map(String) : [];
    for (const key of required) {
      if (!(key in record)) {
        errors.push(`${path}.${key} required`);
      }
    }

    const properties =
      current.properties && typeof current.properties === 'object'
        ? (current.properties as Record<string, Schema>)
        : {};
    if (current.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key} additional property`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in record) {
        errors.push(...validate(propertySchema, record[key], `${path}.${key}`));
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((item) => matchesType(value, item));
  }
  if (expected === 'object') {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
  if (expected === 'array') {
    return Array.isArray(value);
  }
  if (expected === 'integer') {
    return Number.isInteger(value);
  }
  if (expected === 'number') {
    return typeof value === 'number';
  }
  if (expected === 'null') {
    return value === null;
  }
  return typeof value === expected;
}

describe('protocol JSON Schemas', () => {
  test('canonical fixtures validate against shared schemas', () => {
    const fixture = loadJson(FIXTURE);
    for (const [schemaName, fixtureKey] of Object.entries(schemaFixtureMap)) {
      const errors = validate(schema(schemaName), fixture[fixtureKey], fixtureKey);
      expect(errors).toEqual([]);
    }
  });

  test('error schema codes are documented', () => {
    const errorSchema = schema('error-response.schema.json');
    const codeSchema = (errorSchema.properties as Record<string, Schema>).code;
    const codes = (codeSchema?.enum ?? []) as string[];
    const catalog = readFileSync(join(ROOT, 'ERRORS.md'), 'utf8');
    for (const code of codes) {
      expect(catalog).toContain(`\`${code}\``);
    }
  });
});
