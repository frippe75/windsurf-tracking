"""On-demand evaluation harnesses for the AI-model prompts the platform depends on.

These score a *model* against deterministic checks so swapping one model for another
(e.g. moving off a Frontier API to an open/cheaper one) is a measured decision. They call
real endpoints, so they are opt-in — never part of the default unit suite.
"""
