import React, {useEffect, useRef, useState} from 'react';
import './App.css';
import {Container} from "@cloudscape-design/components";

export default function (props: { imgData: any }) {
    const img = props.imgData;
    const [scale, setScale] = useState<number>(1);
    const [position, setPosition] = useState<{ x: number, y: number }>({x: 0, y: 0});
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number, y: number }>({x: 0, y: 0});
    const containerRef = useRef<HTMLDivElement>(null);


    // Handle mouse wheel for zooming
    const handleWheel = (e: React.WheelEvent|WheelEvent) => {
        if(e instanceof WheelEvent) {
            e.preventDefault();
        }
        const newY =  position.y - e.deltaY;
        const newX =  position.x - e.deltaX;
        setPosition({x: newX, y: newY});
    };

    // Handle mouse down for dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({x: e.clientX - position.x, y: e.clientY - position.y});
    };

    // Handle mouse move for dragging
    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            setPosition({x: newX, y: newY});
        }
    };

    // Handle mouse up to stop dragging
    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Handle touch events for mobile/touchpad
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            setIsDragging(true);
            setDragStart({x: touch.clientX - position.x, y: touch.clientY - position.y});
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (isDragging && e.touches.length === 1) {
            const touch = e.touches[0];
            const newX = touch.clientX - dragStart.x;
            const newY = touch.clientY - dragStart.y;
            setPosition({x: newX, y: newY});
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.addEventListener('wheel', handleWheel, {capture: true})

    }, [containerRef]);

    // Add pinch-to-zoom functionality for touchpad
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let initialDistance = 0;
        let initialScale = 1;

        const handleTouchStartZoom = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                initialDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialScale = scale;
            }
        };

        const handleTouchMoveZoom = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                const currentDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );

                if (initialDistance > 0) {
                    const newScale = Math.min(
                        Math.max(0.1, initialScale * (currentDistance / initialDistance)),
                        10
                    );
                    setScale(newScale);
                }
            }
        };


        container.addEventListener('touchstart', handleTouchStartZoom);
        container.addEventListener('touchmove', handleTouchMoveZoom);

        return () => {
            container.removeEventListener('touchstart', handleTouchStartZoom);
            container.removeEventListener('touchmove', handleTouchMoveZoom);
        };
    }, [scale]);

    return (
        <div className="image-viewer-container">
            <div className="zoom-controls">
                <button onClick={() => setScale(Math.max(0.1, scale - 0.1))}>-</button>
                <span>{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale(Math.min(10, scale + 0.1))}>+</button>
                <button onClick={() => {
                    setScale(1);
                    setPosition({x: 0, y: 0});
                }}>Reset
                </button>
            </div>
            <div
                ref={containerRef}
                className="image-container"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >

                <div
                    className="image-wrapper"
                    style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        cursor: isDragging ? 'grabbing' : 'grab',
                    }}
                >
                    <img src={img} alt="Uploaded" className="image"/>
                </div>

            </div>
        </div>
    );
};