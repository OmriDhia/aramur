/**
 * Simple exponential pose smoothing helper to avoid jitter when refining anchors.
 */
export class PoseSmoother {
    constructor(alpha = 0.15) {
        this.alpha = alpha;
        this.position = null;
        this.quaternion = null;
    }

    reset() {
        this.position = null;
        this.quaternion = null;
    }

    smooth(position, quaternion) {
        if (!this.position) {
            this.position = position.clone();
        } else {
            this.position.lerp(position, this.alpha);
        }

        if (!this.quaternion) {
            this.quaternion = quaternion.clone();
        } else {
            this.quaternion.slerp(quaternion, this.alpha);
        }

        return {
            position: this.position.clone(),
            quaternion: this.quaternion.clone(),
        };
    }
}
