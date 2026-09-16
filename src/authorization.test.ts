import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStaffRole,
  parentCanReadChild,
  staffCan,
  staffCapabilities,
  staffRolesFor,
} from "./authorization.js";

test("practitioners can create daily update evidence", () => {
  assert.equal(
    staffCan("practitioner", "observation:create"),
    true
  );

  assert.equal(
    staffCan("practitioner", "draft:create"),
    true
  );

  assert.equal(
    staffCan("practitioner", "content-review:create"),
    true
  );

  assert.equal(
    staffCan("practitioner", "evaluation:create"),
    true
  );
});

test("practitioners cannot approve or publish", () => {
  assert.equal(
    staffCan("practitioner", "approval:create"),
    false
  );

  assert.equal(
    staffCan("practitioner", "publication:create"),
    false
  );
});

test("approvers inherit practitioner capabilities", () => {
  assert.equal(
    staffCan("approver", "observation:create"),
    true
  );

  assert.equal(
    staffCan("approver", "content-review:create"),
    true
  );
});

test("approvers can approve and publish", () => {
  assert.equal(
    staffCan("approver", "approval:create"),
    true
  );

  assert.equal(
    staffCan("approver", "publication:create"),
    true
  );
});

test("admins have every staff capability", () => {
  for (const capability of staffCapabilities) {
    assert.equal(
      staffCan("admin", capability),
      true,
      `Expected admin to have ${capability}`
    );
  }
});

test("recognises only supported staff roles", () => {
  assert.equal(isStaffRole("practitioner"), true);
  assert.equal(isStaffRole("approver"), true);
  assert.equal(isStaffRole("admin"), true);

  assert.equal(isStaffRole("parent"), false);
  assert.equal(isStaffRole("owner"), false);
  assert.equal(isStaffRole(null), false);
});

test("parents can read an explicitly assigned child", () => {
  assert.equal(parentCanReadChild(true), true);
});

test("parents cannot read an unassigned child", () => {
  assert.equal(parentCanReadChild(false), false);
});

test("returns only roles granted a capability", () => {
  assert.deepEqual(
    staffRolesFor("approval:create"),
    ["approver", "admin"]
  );

  assert.deepEqual(
    staffRolesFor("observation:create"),
    ["practitioner", "approver", "admin"]
  );
});