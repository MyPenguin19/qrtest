-- Keep historical roles and attribution; new PIN employees use Staff.
alter type restaurant_role add value if not exists 'staff';
