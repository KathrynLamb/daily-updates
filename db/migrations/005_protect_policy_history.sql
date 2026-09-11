CREATE FUNCTION prevent_policy_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Policy versions cannot be changed or deleted. Create a new version.';
END;
$$;

CREATE TRIGGER evaluation_policies_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE
ON evaluation_policies
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_policy_changes();