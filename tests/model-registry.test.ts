import {describe, expect, test} from 'bun:test'
import {listModelProfiles, resolveModel} from '../src/llm/registry/model-registry'

describe('model registry', () => {
    test('resolves every profile to a provider-qualified model id', () => {
        for (const profile of Object.keys(listModelProfiles()) as Array<keyof ReturnType<typeof listModelProfiles>>) {
            expect(resolveModel(profile)).toContain(':')
        }
    })
})
